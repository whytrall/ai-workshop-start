// The decisions in spec/analysis.md and spec/cli.md, checked on what the real command prints for
// ./fixture and for a small GitHub repository answered in tests/helpers.ts. The edge cases of
// where skills live are yours to add.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { openGitHub, parseGitHubUrl } from '../src/core/github.ts';
import { parseSkill } from '../src/core/parse.ts';
import { replay } from '../src/core/replay.ts';
import { ALIAS_BOMB, atlas, CLI, EXAMPLE_COMMIT, FIXTURE } from './helpers.ts';

const fixture = await atlas(['scan', FIXTURE]);
const example = await atlas(['scan', 'github.com/JetBrains/example']);

test('malformed front matter → the directory name, no description and a warning', () => {
  const parsed = parseSkill(readFileSync(join(FIXTURE, '.agents/skills/release-checklist/SKILL.md'), 'utf8'));
  assert.equal(parsed.name, undefined);
  assert.equal(parsed.description, '');
  assert.equal(
    parsed.warning,
    'malformed front matter: Nested mappings are not allowed in compact mappings at line 3, column 14; using the directory name',
  );
});

test('front matter too costly to build (a YAML alias bomb) is malformed, not a crash', () => {
  const parsed = parseSkill(ALIAS_BOMB);
  assert.equal(parsed.name, undefined);
  assert.equal(parsed.description, '');
  assert.deepEqual(parsed.properties, {});
  assert.equal(parsed.body, '# Bomb');
  assert.equal(
    parsed.warning,
    'malformed front matter: Excessive alias count indicates a resource exhaustion attack; using the directory name',
  );
});

test('scan prints the repository, then each skill with its first sentence and pinned link', () => {
  assert.equal(example.code, 0, example.stderr);
  assert.equal(
    example.stdout,
    [
      'JetBrains/example · 1 skill',
      'commits — Write commit messages the way this repository does.',
      `  https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md`,
    ].join('\n'),
  );
});

test('./fixture: every skill, sorted by name, linked to its file, with a warning for the malformed one', () => {
  const root = pathToFileURL(FIXTURE).href;
  assert.equal(fixture.code, 0);
  assert.equal(
    fixture.stdout,
    [
      'fixture · 3 skills',
      "code-style — Follow the project's code style.",
      `  ${root}/.github/skills/code-style/SKILL.md`,
      'commits — Write commit messages the way this repository does.',
      `  ${root}/.claude/skills/commits/SKILL.md`,
      'release-checklist',
      `  ${root}/.agents/skills/release-checklist/SKILL.md`,
    ].join('\n'),
  );
  assert.match(fixture.stderr, /^warning: \.agents\/skills\/release-checklist\/SKILL\.md: malformed front matter: /);
});

test('the CLI prints the result at once and stores nothing', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'skill-atlas-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const scanned = spawnSync(process.execPath, [CLI, 'scan', FIXTURE], { cwd, encoding: 'utf8' });
  assert.equal(scanned.status, 0, scanned.stderr);
  assert.equal(scanned.stdout, `${fixture.stdout}\n`);
  assert.deepEqual(readdirSync(cwd), []);
});

test('unreachable repository → a clear message, exit code 1', async () => {
  const missing = spawnSync(process.execPath, [CLI, 'scan', join(FIXTURE, 'no-such-directory')], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /^Not a GitHub URL or a readable directory: .*no-such-directory\n$/);

  // An empty argument is neither, not the current directory (FIXTURE, here, has skills).
  const empty = spawnSync(process.execPath, [CLI, 'scan', ''], { cwd: FIXTURE, encoding: 'utf8' });
  assert.equal(empty.status, 1);
  assert.equal(empty.stdout, '');
  assert.equal(empty.stderr, "Not a GitHub URL or a readable directory: ''\n");

  // What GitHub answers for a repository that does not exist.
  const notFound = replay({ 'https://api.github.com/repos/JetBrains/no-such-repository': { status: 404, body: { message: 'Not Found' } } });
  await assert.rejects(openGitHub('https://github.com/JetBrains/no-such-repository', { fetch: notFound }), {
    message: 'Repository not found: https://github.com/JetBrains/no-such-repository',
  });

  const offline = await atlas(['scan', 'https://github.com/JetBrains/not-answered']);
  assert.equal(offline.code, 1);
  assert.match(offline.stderr, /^Cannot reach GitHub: not recorded: https:\/\/api\.github\.com\/repos\/JetBrains\/not-answered$/);
});

test('`.` or `..` as owner or repository → not a GitHub URL, exit code 1, nothing asked of GitHub', async () => {
  const dotted = [
    'https://github.com/../rate_limit',
    'https://github.com/a/..',
    'https://github.com/a/../',
    'https://github.com/a/...git',
    'https://github.com/./a',
    'https://github.com/a/.',
    'www.github.com/../rate_limit',
  ];
  const asked: string[] = [];
  const fetch = (url: string) => {
    asked.push(url);
    return Promise.reject(new Error(`asked: ${url}`));
  };
  for (const url of dotted) {
    assert.equal(parseGitHubUrl(url), undefined, url);
    await assert.rejects(openGitHub(url, { fetch, token: 'secret' }), { message: `Not a GitHub repository URL: ${url}` });
    const scanned = await atlas(['scan', url]);
    assert.equal(scanned.code, 1, url);
    assert.equal(scanned.stdout, '', url);
    assert.equal(scanned.stderr, `Not a GitHub URL or a readable directory: ${url}`);
  }
  assert.deepEqual(asked, []);

  // Dots inside a name are still names.
  assert.deepEqual(parseGitHubUrl('https://github.com/a/.github'), { owner: 'a', repo: '.github' });
  assert.deepEqual(parseGitHubUrl('https://github.com/a.b/c..d.git'), { owner: 'a.b', repo: 'c..d' });
});

test('rate limit → a message that asks for GITHUB_TOKEN', async () => {
  const limited = replay({
    'https://api.github.com/repos/JetBrains/MPS': {
      status: 403,
      body: { message: 'API rate limit exceeded for 192.0.2.1. (But here is the good news: ...)' },
    },
  });
  await assert.rejects(openGitHub('https://github.com/JetBrains/MPS', { fetch: limited }), {
    message: 'GitHub rate limit reached; set GITHUB_TOKEN',
  });
});
