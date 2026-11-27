// spec/cluster.md: the clustering of skills. The model's answer is replayed from tests/recordings/.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { run } from '../src/commands.ts';
import { clusterSkills, sharedWords, UNCLUSTERED } from '../src/core/cluster.ts';
import type { Skill } from '../src/core/model.ts';
import { replayModel, type ModelRecording } from '../src/core/replay.ts';
import { serveWeb } from '../src/web.ts';
import { FIXTURE, open } from './helpers.ts';

const recording: ModelRecording = JSON.parse(readFileSync(new URL('./recordings/cluster-fixture.json', import.meta.url), 'utf8'));
const model = replayModel(recording);

async function cluster(args: string[], withModel = true) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(['cluster', ...args], { open, model: withModel ? model : undefined, print: (t) => stdout.push(t), error: (t) => stderr.push(t) });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

const skill = (name: string, description: string): Skill => ({ id: name, repository: 'r', path: name, name, description, commit: '', copies: [] });

test('cluster prints each cluster with its topics and skills, from the recorded answer', async () => {
  const { code, stdout, stderr } = await cluster([FIXTURE]);
  assert.equal(code, 0, stderr);
  assert.equal(
    stdout,
    [
      `${stdout.split(' · ')[0]} · 3 skills in 2 clusters`,
      'Commits and code style · 2 skills',
      '  topics: git history, conventions',
      '  code-style — Follow the project\'s code style.',
      `    ${pathToFileURL(FIXTURE).href}/.github/skills/code-style/SKILL.md`,
      '  commits — Write commit messages the way this repository does.',
      `    ${pathToFileURL(FIXTURE).href}/.claude/skills/commits/SKILL.md`,
      'Releases · 1 skill',
      '  topics: release process',
      '  release-checklist',
      `    ${pathToFileURL(FIXTURE).href}/.agents/skills/release-checklist/SKILL.md`,
    ].join('\n'),
  );
});

test('an unknown skill in the answer is a warning on stderr', async () => {
  const { stderr } = await cluster([FIXTURE]);
  assert.match(stderr, /warning: the model named an unknown skill: ghost/);
});

test('shared words: in 2+ skills, no stop words, most common first, then alphabetical', () => {
  const words = sharedWords([
    skill('a', 'Bump the Gradle plugin version.'),
    skill('b', 'Update Gradle plugin docs'),
    skill('c', 'Gradle release notes'),
  ]);
  assert.deepEqual(words, ['gradle', 'plugin']);
});

test('a word repeated inside one skill is not shared', () => {
  assert.deepEqual(sharedWords([skill('a', 'cache cache cache'), skill('b', 'something else')]), []);
});

test('skills the model left out go to Unclustered, with a warning', async () => {
  const skills = [skill('x', 'alpha beta'), skill('y', 'alpha beta')];
  const result = await clusterSkills(skills, async () => '{"clusters":[{"title":"T","topics":["t"],"skills":["x"]}]}');
  assert.deepEqual(result.clusters.map((c) => [c.title, c.skills.map((s) => s.name)]), [['T', ['x']], [UNCLUSTERED, ['y']]]);
  assert.deepEqual(result.warnings, ['the model left out: y']);
});

test('a skill in several clusters stays in the first, with a warning', async () => {
  const skills = [skill('x', ''), skill('y', '')];
  const answer = '{"clusters":[{"title":"A","skills":["x"]},{"title":"B","skills":["x","y"]}]}';
  const result = await clusterSkills(skills, async () => answer);
  assert.deepEqual(result.clusters.map((c) => c.skills.map((s) => s.name)), [['x'], ['y']]);
  assert.equal(result.warnings.length, 1);
});

test('an answer that is not JSON, or has no clusters, is an error: exit code 1', async () => {
  for (const answer of ['no idea', '{"groups":[]}']) {
    const stderr: string[] = [];
    const code = await run(['cluster', FIXTURE], { open, model: async () => answer, print() {}, error: (t) => stderr.push(t) });
    assert.equal(code, 1);
    assert.match(stderr.join('\n'), /The model/);
  }
});

test('no skills → no clusters, and the model is not asked', async () => {
  const result = await clusterSkills([], async () => assert.fail('asked'));
  assert.deepEqual(result, { clusters: [], warnings: [] });
});

test('an unrecorded prompt fails: a replay never reaches a real model', async () => {
  await assert.rejects(model('other'), /not recorded/);
});

test('cluster needs one argument and a model', async () => {
  assert.equal((await cluster([])).code, 1);
  const noModel = await cluster([FIXTURE], false);
  assert.equal(noModel.code, 1);
  assert.match(noModel.stderr, /needs a model/);
});

test('web /cluster: each cluster with topics and its skills in a table; warnings; escaped', async () => {
  const web = await serveWeb({ open, model, github: { fetch: () => Promise.reject(new Error('offline')) }, port: 0 });
  try {
    const url = new URL('/cluster', web.url);
    url.searchParams.set('repo', FIXTURE);
    const response = await fetch(url);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /3 skills in 2 clusters/);
    assert.match(html, /<h3 class="cluster">Commits and code style &middot; 2 skills<\/h3>/);
    assert.match(html, /Topics: git history, conventions/);
    const cells = [...html.matchAll(/<td class="name"><a href="[^"]+">([^<]+)<\/a>/g)].map((m) => m[1]);
    assert.deepEqual(cells, ['code-style', 'commits', 'release-checklist']);
    assert.match(html, /the model named an unknown skill: ghost/);
    assert.match(html, /show the plain list/);
    // The plain result links to it.
    const plain = new URL('/', web.url);
    plain.searchParams.set('repo', FIXTURE);
    assert.match(await (await fetch(plain)).text(), /<a href="\/cluster\?repo=[^"]+">Cluster these skills by topic<\/a>/);
  } finally {
    await web.close();
  }
});

test('web /cluster without a model → an error box, status 400', async () => {
  const web = await serveWeb({ open, github: { fetch: () => Promise.reject(new Error('offline')) }, port: 0 });
  try {
    const response = await fetch(new URL(`/cluster?repo=${encodeURIComponent(FIXTURE)}`, web.url));
    assert.equal(response.status, 400);
    assert.match(await response.text(), /Clustering needs a model/);
  } finally {
    await web.close();
  }
});

// Exercise the scan, CLI and HTTP boundary with distinct folders sharing a name.
test('same-named skills survive clustering, copies print, and leftovers stay visible', async () => {
  const files: Record<string, string> = {
    '.claude/skills/a/SKILL.md': '---\nname: deploy\ndescription: Release deployment tooling.\n---',
    '.agents/skills/a/SKILL.md': '---\nname: deploy\ndescription: Release deployment tooling.\n---',
    '.github/skills/b/SKILL.md': '---\nname: deploy\ndescription: Release deployment automation.\n---',
    '.claude/skills/c/SKILL.md': '---\nname: lint\n---',
  };
  const source = {
    repository: { id: 'example/repo', organization: 'example', name: 'repo', url: 'https://github.com/example/repo', commit: 'abc' },
    paths: Object.keys(files), warnings: [],
    read: async (path: string) => new TextEncoder().encode(files[path]),
  };
  const answer = async () => JSON.stringify({ clusters: [{ title: 'Ops', skills: ['deploy'] }, { title: 'Repeated', skills: ['deploy'] }] });
  const stdout: string[] = [], stderr: string[] = [];
  assert.equal(await run(['cluster', 'example'], { open: async () => source, model: answer, print: (s) => stdout.push(s), error: (s) => stderr.push(s) }), 0);
  const text = stdout.join('\n');
  assert.match(text, /3 skills in 2 clusters/);
  assert.equal(stdout.filter((s) => s.startsWith('  deploy')).length, 2);
  assert.match(text, /also in .claude\/skills\/a\/SKILL.md/);
  assert.ok(text.indexOf('shared words:') > text.indexOf('/.github/skills/b/SKILL.md'));
  assert.match(text, /Unclustered.*\n  lint/s);
  assert.match(stderr.join('\n'), /several clusters/);
  assert.match(stderr.join('\n'), /left out: lint/);
  const web = await serveWeb({ open: async () => source, model: answer, github: { fetch: () => Promise.reject(new Error('offline')) }, port: 0 });
  try {
    const response = await fetch(new URL('/cluster?repo=example', web.url));
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /3 skills in 2 clusters/);
    assert.match(html, /\/.agents\/skills\/a\/SKILL.md/);
    assert.match(html, /\/.github\/skills\/b\/SKILL.md/);
    assert.match(html, /also in .claude\/skills\/a\/SKILL.md/);
    assert.match(html, /Unclustered/);
  } finally { await web.close(); }
});
