// The edge cases of "What a project skill is" in spec/analysis.md, through the same commands the CLI
// runs. Local projects are real folders built by each test; GitHub answers from a recording.
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test, type TestContext } from 'node:test';
import { run } from '../src/commands.ts';
import { openGitHub } from '../src/core/github.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { atlas, EXAMPLE_COMMIT } from './helpers.ts';

/** A local project named `my-project`, with these files (path → text) and symbolic links (link → target). */
function project(t: TestContext, files: Record<string, string>, links: Record<string, string> = {}) {
  const base = mkdtempSync(join(tmpdir(), 'skill-atlas-project-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'my-project');
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  for (const [link, target] of Object.entries(links)) {
    mkdirSync(dirname(join(root, link)), { recursive: true });
    symlinkSync(join(root, target), join(root, link));
  }
  return { root, href: pathToFileURL(root).href };
}

/** A SKILL.md with this front matter (lines, without the --- fences) and a body. */
const skillFile = (front: string) => `---\n${front}\n---\n# Body\n`;

test('only a file named exactly SKILL.md is a skill', async (t) => {
  const { root, href } = project(t, {
    '.claude/skills/a/skill.md': skillFile('description: Lower case.'),
    '.claude/skills/b/SKILL.md.bak': skillFile('description: Backup.'),
    '.claude/skills/c/MY-SKILL.md': skillFile('description: Other name.'),
    '.claude/skills/real/SKILL.md': skillFile('description: Real.'),
  });
  const result = await atlas(['scan', root]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, ['my-project · 1 skill', 'real — Real.', `  ${href}/.claude/skills/real/SKILL.md`].join('\n'));
});

test('only one folder under a root is a skill: nothing deeper, shallower, elsewhere or at the root', async (t) => {
  const { root, href } = project(t, {
    '.claude/skills/SKILL.md': skillFile('description: No folder.'),
    '.claude/skills/deep/nested/SKILL.md': skillFile('description: Too deep.'),
    'docs/skills/x/SKILL.md': skillFile('description: Not a root.'),
    'tests/x/SKILL.md': skillFile('description: Test data.'),
    'skills/y/SKILL.md': skillFile('description: Not a root either.'),
    'SKILL.md': skillFile('description: At the root.'),
    'agent/skills/z/SKILL.md': skillFile('description: The fourth root.'),
    '.claude/skills/ok/SKILL.md': skillFile('description: Exactly right.'),
  });
  const result = await atlas(['scan', root]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(
    result.stdout,
    [
      'my-project · 2 skills',
      'ok — Exactly right.',
      `  ${href}/.claude/skills/ok/SKILL.md`,
      'z — The fourth root.',
      `  ${href}/agent/skills/z/SKILL.md`,
    ].join('\n'),
  );
});

test('the same name in several roots is one skill: its home is the first path, the others are also in', async (t) => {
  const copy = skillFile('description: Reviews code.');
  const { root, href } = project(t, {
    '.github/skills/review/SKILL.md': copy,
    '.claude/skills/review/SKILL.md': copy,
    '.agents/skills/review/SKILL.md': copy,
  });
  const result = await atlas(['scan', root]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(
    result.stdout,
    [
      'my-project · 1 skill',
      'review — Reviews code.',
      `  ${href}/.agents/skills/review/SKILL.md`,
      '  also in .claude/skills/review/SKILL.md, .github/skills/review/SKILL.md',
    ].join('\n'),
  );
});

test('symbolic links are not skills, neither a linked file nor a linked folder', async (t) => {
  const { root, href } = project(
    t,
    { '.claude/skills/real/SKILL.md': skillFile('description: Real.') },
    { '.claude/skills/linked/SKILL.md': '.claude/skills/real/SKILL.md', '.claude/skills/alias': '.claude/skills/real' },
  );
  const result = await atlas(['scan', root]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, ['my-project · 1 skill', 'real — Real.', `  ${href}/.claude/skills/real/SKILL.md`].join('\n'));
});

test('the name: front matter, trimmed; a number counts as text; empty, a list or missing gives the folder', async (t) => {
  const { root, href } = project(t, {
    '.claude/skills/padded/SKILL.md': skillFile('name: "  Spaced  "\ndescription: Padded.'),
    '.claude/skills/number/SKILL.md': skillFile('name: 42\ndescription: Number.'),
    '.claude/skills/empty/SKILL.md': skillFile('name: ""\ndescription: Empty.'),
    '.claude/skills/list/SKILL.md': skillFile('name: [a, b]\ndescription: List.'),
  });
  const result = await atlas(['scan', root]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, '', 'a name that is not text gives the folder name without a warning');
  assert.equal(
    result.stdout,
    [
      'my-project · 4 skills',
      '42 — Number.',
      `  ${href}/.claude/skills/number/SKILL.md`,
      'Spaced — Padded.',
      `  ${href}/.claude/skills/padded/SKILL.md`,
      'empty — Empty.',
      `  ${href}/.claude/skills/empty/SKILL.md`,
      'list — List.',
      `  ${href}/.claude/skills/list/SKILL.md`,
    ].join('\n'),
  );
});

test('the description: its first sentence, folded lines joined; without one, the name alone', async (t) => {
  const { root, href } = project(t, {
    '.claude/skills/folded/SKILL.md': '---\ndescription: >\n  Write things.\n  Then more.\n---\n',
    '.claude/skills/bare/SKILL.md': skillFile('name: bare'),
  });
  const result = await atlas(['scan', root]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(
    result.stdout,
    [
      'my-project · 2 skills',
      'bare',
      `  ${href}/.claude/skills/bare/SKILL.md`,
      'folded — Write things.',
      `  ${href}/.claude/skills/folded/SKILL.md`,
    ].join('\n'),
  );
});

test('no front matter, or front matter never closed → a warning, the folder name, and the scan goes on', async (t) => {
  const { root, href } = project(t, {
    '.claude/skills/nofm/SKILL.md': '# Just a body\n',
    '.claude/skills/open/SKILL.md': '---\nname: open\n',
  });
  const result = await atlas(['scan', root]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(
    result.stdout,
    ['my-project · 2 skills', 'nofm', `  ${href}/.claude/skills/nofm/SKILL.md`, 'open', `  ${href}/.claude/skills/open/SKILL.md`].join('\n'),
  );
  assert.equal(
    result.stderr,
    [
      'warning: .claude/skills/nofm/SKILL.md: no front matter; using the directory name',
      'warning: .claude/skills/open/SKILL.md: front matter without a closing ---; using the directory name',
    ].join('\n'),
  );
});

test('a folder name with spaces and symbols is percent-encoded in the link', async (t) => {
  const { root, href } = project(t, { '.claude/skills/Plan & Ship/SKILL.md': skillFile('description: Plans.') });
  const result = await atlas(['scan', root]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(
    result.stdout,
    ['my-project · 1 skill', 'Plan & Ship — Plans.', `  ${href}/.claude/skills/Plan%20%26%20Ship/SKILL.md`].join('\n'),
  );
});

/** Scans a GitHub repository without a token, so skills come from the tree, as recorded. */
async function scanGitHubTree(url: string, recording: Recording) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(['scan', url], {
    open: (input) => openGitHub(input, { fetch: replay(recording) }),
    print: (text) => stdout.push(text),
    error: (text) => stderr.push(text),
  });
  return { code, stdout: stdout.join('\n'), stderr: stderr.join('\n') };
}

/** Makes these folders of the project unreadable for the test's duration; they are readable again for clean-up. */
function lock(root: string, folders: string[]) {
  for (const folder of folders) mkdirSync(join(root, folder), { recursive: true });
  for (const folder of folders) chmodSync(join(root, folder), 0o000);
  // Called in a finally: project()'s clean-up cannot remove a folder it cannot read.
  return () => folders.forEach((folder) => chmodSync(join(root, folder), 0o755));
}

// Root reads every folder, so these cases need another user.
const asRoot = process.getuid?.() === 0 && 'root can read an unreadable folder';

test('an unreadable folder in the directory is skipped with a warning; the skills are listed', { skip: asRoot }, async (t) => {
  const { root, href } = project(t, {
    '.claude/skills/ok/SKILL.md': skillFile('description: Fine.'),
    'docs/readme.md': 'Docs.',
  });
  const unlock = lock(root, ['secret', 'docs/private']);
  try {
    const result = await atlas(['scan', root]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, ['my-project · 1 skill', 'ok — Fine.', `  ${href}/.claude/skills/ok/SKILL.md`].join('\n'));
    // In the order the file system lists the folders.
    assert.deepEqual(result.stderr.split('\n').sort(), [
      'warning: docs/private/: cannot read the directory (EACCES); skipped',
      'warning: secret/: cannot read the directory (EACCES); skipped',
    ]);
  } finally {
    unlock();
  }
});

test('an unreadable skill folder is skipped with a warning; the other skills are listed', { skip: asRoot }, async (t) => {
  const { root, href } = project(t, {
    '.claude/skills/ok/SKILL.md': skillFile('description: Fine.'),
    '.github/skills/hidden/SKILL.md': skillFile('description: Cannot be read.'),
  });
  const unlock = lock(root, ['.github/skills/hidden']);
  try {
    const result = await atlas(['scan', root]);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.stdout, ['my-project · 1 skill', 'ok — Fine.', `  ${href}/.claude/skills/ok/SKILL.md`].join('\n'));
    assert.equal(result.stderr, 'warning: .github/skills/hidden/: cannot read the directory (EACCES); skipped');
  } finally {
    unlock();
  }
});

test('an unreadable scanned directory → a clear message, exit code 1', { skip: asRoot }, async (t) => {
  const { root } = project(t, { '.claude/skills/ok/SKILL.md': skillFile('description: Fine.') });
  const unlock = lock(root, ['.']);
  try {
    const result = await atlas(['scan', root]);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, `Not a GitHub URL or a readable directory: ${root}`);
  } finally {
    unlock();
  }
});

test('GitHub: a symbolic link is not a skill; a SKILL.md missing at the commit is skipped with a warning', async () => {
  const api = 'https://api.github.com/repos/JetBrains/layout';
  const raw = `https://raw.githubusercontent.com/JetBrains/layout/${EXAMPLE_COMMIT}`;
  const result = await scanGitHubTree(
    'https://github.com/JetBrains/layout',
    {
      [api]: { status: 200, body: { full_name: 'JetBrains/layout', default_branch: 'main' } },
      [`${api}/commits/main`]: { status: 200, body: { sha: EXAMPLE_COMMIT } },
      [`${api}/git/trees/${EXAMPLE_COMMIT}?recursive=1`]: {
        status: 200,
        body: {
          truncated: false,
          tree: [
            { path: '.claude/skills/real/SKILL.md', mode: '100644', type: 'blob', sha: 'a' },
            { path: '.claude/skills/gone/SKILL.md', mode: '100644', type: 'blob', sha: 'b' },
            { path: '.claude/skills/linked/SKILL.md', mode: '120000', type: 'blob', sha: 'c' },
          ],
        },
      },
      [`${raw}/.claude/skills/real/SKILL.md`]: { status: 200, body: skillFile('description: Real skill.') },
      [`${raw}/.claude/skills/gone/SKILL.md`]: { status: 404, body: { message: 'Not Found' } },
    },
  );
  assert.equal(result.code, 0, result.stderr);
  assert.equal(
    result.stdout,
    [
      'JetBrains/layout · 1 skill',
      'real — Real skill.',
      `  https://github.com/JetBrains/layout/blob/${EXAMPLE_COMMIT}/.claude/skills/real/SKILL.md`,
    ].join('\n'),
  );
  assert.equal(result.stderr, 'warning: .claude/skills/gone/SKILL.md: listed, but not found at the scanned commit; skipped');
});

test('GitHub: a tree too large to list is read only in the roots, with a warning; a skill elsewhere is not read', async () => {
  const api = 'https://api.github.com/repos/JetBrains/large';
  const sha = EXAMPLE_COMMIT;
  const result = await scanGitHubTree(
    'https://github.com/JetBrains/large',
    {
      [api]: { status: 200, body: { full_name: 'JetBrains/large', default_branch: 'main' } },
      [`${api}/commits/main`]: { status: 200, body: { sha } },
      // The partial answer lists a skill under docs/, but the scan does not use the partial tree.
      [`${api}/git/trees/${sha}?recursive=1`]: {
        status: 200,
        body: { truncated: true, tree: [{ path: 'docs/tools/search/SKILL.md', mode: '100644', type: 'blob', sha: 'x' }] },
      },
      [`${api}/git/trees/${sha}`]: {
        status: 200,
        body: { truncated: false, tree: [{ path: '.claude', mode: '040000', type: 'tree', sha: 'T1' }] },
      },
      [`${api}/git/trees/T1`]: {
        status: 200,
        body: { truncated: false, tree: [{ path: 'skills', mode: '040000', type: 'tree', sha: 'T2' }] },
      },
      [`${api}/git/trees/T2?recursive=1`]: {
        status: 200,
        body: { truncated: false, tree: [{ path: 'review/SKILL.md', mode: '100644', type: 'blob', sha: 's' }] },
      },
      [`https://raw.githubusercontent.com/JetBrains/large/${sha}/.claude/skills/review/SKILL.md`]: {
        status: 200,
        body: skillFile('description: Reviews code.'),
      },
    },
  );
  assert.equal(result.code, 0, result.stderr);
  assert.equal(
    result.stdout,
    ['JetBrains/large · 1 skill', 'review — Reviews code.', `  https://github.com/JetBrains/large/blob/${sha}/.claude/skills/review/SKILL.md`].join('\n'),
  );
  assert.equal(
    result.stderr,
    'warning: the tree is too large to list at once; looked only in .agents/skills, .claude/skills, .github/skills, agent/skills (GITHUB_TOKEN searches everywhere)',
  );
});
