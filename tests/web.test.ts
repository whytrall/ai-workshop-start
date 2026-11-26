// spec/web.md, checked on the pages a real server answers: in this process with GitHub answered
// from tests/helpers.ts, and through the real `./skill-atlas web` command.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, test, type TestContext } from 'node:test';
import { createBrowserBackend } from '../src/browser.ts';
import { serveWeb } from '../src/web.ts';
import { atlas, CLI, EXAMPLE_COMMIT, FIXTURE, open } from './helpers.ts';

const server = await serveWeb({ open, port: 0 });
after(() => server.close());

/** The page for `/?repo=<repo>`, or for a path. */
async function page(repo?: string, path = '/') {
  const url = new URL(path, server.url);
  if (repo !== undefined) url.searchParams.set('repo', repo);
  const response = await fetch(url);
  return { status: response.status, type: response.headers.get('content-type'), html: await response.text() };
}

/** The skills table's rows, as text: tags dropped, whitespace collapsed. */
function rows(html: string): string[] {
  return [...html.matchAll(/<tr class="(?:even|odd)">([\s\S]*?)<\/tr>/g)].map((m) =>
    m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  );
}

/** A local project named `my-project` with these files. */
function project(t: TestContext, files: Record<string, string>) {
  const base = mkdtempSync(join(tmpdir(), 'skill-atlas-web-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = join(base, 'my-project');
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

test('/: the form, an embedded page with no scripts, the counter at zero', async () => {
  const home = await page();
  assert.equal(home.status, 200);
  assert.equal(home.type, 'text/html; charset=utf-8');
  assert.match(home.html, /<form id="scan" class="scan" method="get" action="\/">/);
  assert.match(home.html, /<input id="repo" name="repo" type="text" size="48" value=""/);
  assert.match(home.html, /<marquee/);
  assert.match(home.html, /Under|UNDER<br>CONSTRUCTION/);
  assert.match(home.html, /Netscape Navigator/);
  assert.doesNotMatch(home.html, /<script/i);
  assert.doesNotMatch(home.html, /(?:src|href)="https?:|@import|url\(/);
  assert.match(home.html, /Skills on this page: <span class="counter">(<span>0<\/span>){6}<\/span>/);
  // An empty field is the home page too.
  assert.equal((await page('  ')).html, home.html);
});

test('./fixture: every skill by name, linked, full description or none, and the warning', async () => {
  const root = pathToFileURL(FIXTURE).href;
  const { status, html } = await page(FIXTURE);
  assert.equal(status, 200);
  assert.match(html, /<title>fixture - Skill Atlas<\/title>/);
  assert.match(html, new RegExp(`<h2 class="repo"><a href="${root}">fixture</a> &middot; 3 skills</h2>`));
  assert.doesNotMatch(html, /Scanned commit/);
  assert.deepEqual(rows(html), [
    "1 code-style Follow the project&#39;s code style. Use before committing Kotlin or Java changes.",
    '2 commits Write commit messages the way this repository does. Use for every commit.',
    '3 release-checklist (no description)',
  ]);
  assert.match(html, new RegExp(`<a href="${root}/.github/skills/code-style/SKILL.md">code-style</a>`));
  assert.match(html, new RegExp(`<a href="${root}/.agents/skills/release-checklist/SKILL.md">release-checklist</a>`));
  assert.match(html, /<div class="warnings"><span class="blink">!! Warning !!<\/span><ul><li>\.agents\/skills\/release-checklist\/SKILL\.md: malformed front matter: /);
  assert.match(html, /<span class="counter"><span>0<\/span><span>0<\/span><span>0<\/span><span>0<\/span><span>0<\/span><span>3<\/span><\/span>/);
  // The field keeps what was scanned.
  assert.ok(html.includes(`value="${FIXTURE}"`));
});

test('GitHub: the repository, the scanned commit and the pinned link, as scan prints them', async () => {
  const { status, html } = await page('github.com/JetBrains/example');
  assert.equal(status, 200);
  assert.match(html, /<h2 class="repo"><a href="https:\/\/github.com\/JetBrains\/example">JetBrains\/example<\/a> &middot; 1 skill<\/h2>/);
  assert.match(html, new RegExp(`Scanned commit: <tt>${EXAMPLE_COMMIT}</tt>`));
  assert.ok(html.includes(`<a href="https://github.com/JetBrains/example/blob/${EXAMPLE_COMMIT}/.claude/skills/commits/SKILL.md">commits</a>`));
  assert.deepEqual(rows(html), ['1 commits Write commit messages the way this repository does. Use for every commit.']);
  assert.doesNotMatch(html, /class="warnings"/);
});

test('copies are listed as also in, under the name', async (t) => {
  const root = project(t, {
    '.agents/skills/shared/SKILL.md': '---\ndescription: Shared.\n---\n',
    '.claude/skills/shared/SKILL.md': '---\ndescription: Shared.\n---\n',
  });
  const { html } = await page(root);
  assert.match(html, /my-project<\/a> &middot; 1 skill</);
  assert.match(html, /\/\.agents\/skills\/shared\/SKILL\.md">shared<\/a><div class="copies">also in \.claude\/skills\/shared\/SKILL\.md<\/div>/);
});

test('all text is HTML-escaped: names, descriptions, paths in links', async (t) => {
  const root = project(t, {
    '.claude/skills/my skill/SKILL.md': '---\nname: "<b>bold</b> & co"\ndescription: "<script>alert(\'x\')</script>"\n---\n',
  });
  const { html } = await page(root);
  assert.doesNotMatch(html, /<script|<b>bold/);
  assert.deepEqual(rows(html), ['1 &#60;b&#62;bold&#60;/b&#62; &#38; co &#60;script&#62;alert(&#39;x&#39;)&#60;/script&#62;']);
  assert.match(html, /\/\.claude\/skills\/my%20skill\/SKILL\.md">/);
  // What was typed comes back escaped too.
  const typed = await page('"><script>x</script>');
  assert.doesNotMatch(typed.html, /<script/);
  assert.ok(typed.html.includes('value="&#34;&#62;&#60;script&#62;x&#60;/script&#62;"'));
});

test('no skills → No skills here... yet!', async (t) => {
  const root = project(t, { 'README.md': '# Nothing\n', 'docs/skills/x/SKILL.md': '---\nname: x\n---\n' });
  const { status, html } = await page(root);
  assert.equal(status, 200);
  assert.match(html, /my-project<\/a> &middot; 0 skills/);
  assert.match(html, /<p class="none">No skills here\.\.\. yet!<\/p>/);
  assert.deepEqual(rows(html), []);
});

test('unreachable repository → the message in an error box, status 400', async () => {
  const missing = await page(join(FIXTURE, 'no-such-directory'));
  assert.equal(missing.status, 400);
  assert.match(missing.html, /<div class="error"><div class="error-title">ERROR!!!<\/div>Not a GitHub URL or a readable directory: .*no-such-directory<\/div>/);

  const offline = await page('https://github.com/JetBrains/not-answered');
  assert.equal(offline.status, 400);
  assert.match(offline.html, /Cannot reach GitHub: not recorded: https:\/\/api\.github\.com\/repos\/JetBrains\/not-answered/);
});

test('any other page → 404; only GET and HEAD', async () => {
  const missing = await page(undefined, '/guestbook.html');
  assert.equal(missing.status, 404);
  assert.match(missing.html, /404 - Page Not Found<\/div>There is no page at \/guestbook\.html\./);

  const posted = await fetch(server.url, { method: 'POST' });
  assert.equal(posted.status, 405);
  assert.equal(posted.headers.get('allow'), 'GET, HEAD');
  await posted.body?.cancel();
});

test('the server is local only', () => {
  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
});

test('./skill-atlas web 0: prints its URL and serves the page from the real command', async (t) => {
  const child = spawn(process.execPath, [CLI, 'web', '0'], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const line = await new Promise<string>((resolve, reject) => {
    let out = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      out += chunk;
      if (out.includes('\n')) resolve(out);
    });
    child.once('exit', (code) => reject(new Error(`exited ${code}`)));
  });
  const match = /^Skill Atlas on (http:\/\/127\.0\.0\.1:\d+\/) · Ctrl\+C to stop\n$/.exec(line);
  assert.ok(match, line);
  const response = await fetch(`${match[1]}?repo=${encodeURIComponent(FIXTURE)}`);
  assert.equal(response.status, 200);
  assert.deepEqual(rows(await response.text()).map((row) => row.split(' ')[1]), ['code-style', 'commits', 'release-checklist']);
});

test('web: a port in use → a clear message, exit code 1; a bad port → usage', async (t) => {
  const taken = createServer();
  await new Promise<void>((resolve) => taken.listen(0, '127.0.0.1', resolve));
  t.after(() => taken.close());
  const { port } = taken.address() as { port: number };
  const child = spawn(process.execPath, [CLI, 'web', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
  const code = await new Promise((resolve) => child.once('exit', resolve));
  assert.equal(code, 1);
  assert.match(stderr, new RegExp(`^Cannot start the web view on port ${port}: listen EADDRINUSE`));

  for (const args of [['web', 'abc'], ['web', '1', '2']]) {
    const bad = await atlas(args);
    assert.equal(bad.code, 1);
    assert.equal(bad.stderr, 'Usage: skill-atlas web [port]');
  }
  assert.equal((await atlas(['web', '70000'])).stderr, 'Not a port: 70000');
});

test('web where no server can run, as in the browser terminal → a clear message', async () => {
  const output = await createBrowserBackend({ fetch: () => Promise.reject(new Error('offline')) }).run('skill-atlas web');
  assert.equal(output, 'The web view runs only from the command line: ./skill-atlas web');
  assert.match(await createBrowserBackend().run('help'), /web \[port\]\s+open the web view/);
});
