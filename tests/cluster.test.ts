// spec/cluster.md: the clustering of skills. The model's answer is replayed from tests/recordings/.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { run } from '../src/commands.ts';
import { clusterSkills, sharedWords, UNCLUSTERED } from '../src/core/cluster.ts';
import type { Skill } from '../src/core/model.ts';
import { replayModel, type ModelRecording } from '../src/core/replay.ts';
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
      '  skills: code-style, commits',
      'Releases · 1 skill',
      '  topics: release process',
      '  skills: release-checklist',
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
  assert.deepEqual(result.clusters.map((c) => [c.title, c.skills]), [['T', ['x']], [UNCLUSTERED, ['y']]]);
  assert.deepEqual(result.warnings, ['the model left out: y']);
});

test('a skill in several clusters stays in the first, with a warning', async () => {
  const skills = [skill('x', ''), skill('y', '')];
  const answer = '{"clusters":[{"title":"A","skills":["x"]},{"title":"B","skills":["x","y"]}]}';
  const result = await clusterSkills(skills, async () => answer);
  assert.deepEqual(result.clusters.map((c) => c.skills), [['x'], ['y']]);
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
