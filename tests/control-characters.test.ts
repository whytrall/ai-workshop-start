// "Control characters" in spec/cli.md: what a scanned repository says cannot drive the terminal.
// The repository is a real folder; the first test is the reproduction in issue #15.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, type TestContext } from 'node:test';
import { atlas, CLI } from './helpers.ts';

/** A local project named `my-project`, with these files (path → text). */
function project(t: TestContext, files: Record<string, string>) {
  const base = mkdtempSync(join(tmpdir(), 'skill-atlas-control-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'my-project');
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return { root, href: pathToFileURL(root).href };
}

/** Any C0 control (but the newline between lines), DEL or C1 control. */
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/;

// YAML's double-quoted "\e" is ESC, "\a" is BEL: the front matter of the issue.
const PWNED = '---\nname: "\\e[2J\\e[31mPWNED\\e[0m \\a"\ndescription: "hello \\e]0;owned\\a world. Second."\n---\n# Body\n';

test('ESC and BEL in a name and a description are printed escaped, as \\x1b and \\x07', async (t) => {
  const { root, href } = project(t, { '.claude/skills/x/SKILL.md': PWNED });
  const result = await atlas(['scan', root]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(
    result.stdout,
    [
      'my-project · 1 skill',
      '\\x1b[2J\\x1b[31mPWNED\\x1b[0m \\x07 — hello \\x1b]0;owned\\x07 world.',
      `  ${href}/.claude/skills/x/SKILL.md`,
    ].join('\n'),
  );
});

test('the real CLI writes no control character to stdout or stderr', (t) => {
  const { root } = project(t, {
    '.claude/skills/x/SKILL.md': PWNED,
    '.claude/skills/y/SKILL.md': 'no front matter\n',
  });
  const scanned = spawnSync(process.execPath, [CLI, 'scan', root], { encoding: 'utf8' });
  assert.equal(scanned.status, 0, scanned.stderr);
  assert.doesNotMatch(scanned.stdout, CONTROL);
  assert.doesNotMatch(scanned.stderr, CONTROL);
  assert.match(scanned.stdout, /^\\x1b\[2J\\x1b\[31mPWNED\\x1b\[0m \\x07 — hello \\x1b\]0;owned\\x07 world\.$/m);
});

test('C1 controls, DEL and a newline in a name are escaped too, and keep the skill on one line', async (t) => {
  const { root } = project(t, { '.claude/skills/x/SKILL.md': '---\nname: "a\\x9b31mb\\x7fc\\nd"\n---\n' });
  const result = await atlas(['scan', root]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.split('\n')[1], 'a\\x9b31mb\\x7fc\\x0ad');
});

test('control characters in folder names are escaped in the name, the copies and the warnings', async (t) => {
  const folder = 'evil\u001b]0;owned\u0007';
  const { root } = project(t, {
    [`.agents/skills/${folder}/SKILL.md`]: 'no front matter\n',
    [`.claude/skills/${folder}/SKILL.md`]: 'no front matter\n',
  });
  const result = await atlas(['scan', root]);
  assert.equal(result.code, 0, result.stderr);
  const lines = result.stdout.split('\n');
  assert.equal(lines[1], 'evil\\x1b]0;owned\\x07');
  // The link is a file:// URL: the path is percent-encoded already.
  assert.match(lines[2], /\/\.agents\/skills\/evil%1B%5D0%3Bowned%07\/SKILL\.md$/);
  assert.equal(lines[3], '  also in .claude/skills/evil\\x1b]0;owned\\x07/SKILL.md');
  assert.doesNotMatch(result.stdout, CONTROL);
  // Only the home is read, so only it is warned about.
  assert.equal(result.stderr, 'warning: .agents/skills/evil\\x1b]0;owned\\x07/SKILL.md: no front matter; using the directory name');
});
