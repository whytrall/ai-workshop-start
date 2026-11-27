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

const server = await serveWeb({ open, github: { fetch: () => Promise.reject(new Error('offline')) }, port: 0 });
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

test('HEAD → the status and headers, without scanning anything', async (t) => {
  const opened: string[] = [];
  const asked: string[] = [];
  const web = await serveWeb({
    open: (input) => (opened.push(input), open(input)),
    github: { fetch: (url) => (asked.push(String(url)), Promise.reject(new Error('offline'))) },
    port: 0,
  });
  t.after(() => web.close());
  const cases: [string, number][] = [
    ['/', 200],
    [`/?repo=${encodeURIComponent(FIXTURE)}`, 200],
    ['/?repo=github.com/JetBrains/example&q=commit', 200],
    // Not scanned, so not known to fail: a GET would answer 400.
    [`/?repo=${encodeURIComponent(join(FIXTURE, 'no-such-directory'))}`, 200],
    ['/org', 200],
    ['/org?org=JetBrains', 200],
    ['/guestbook.html', 404],
  ];
  for (const [path, status] of cases) {
    const response = await fetch(new URL(path, web.url), { method: 'HEAD' });
    assert.equal(response.status, status, path);
    assert.equal(response.headers.get('content-type'), 'text/html; charset=utf-8', path);
    assert.equal(response.headers.get('cache-control'), 'no-store', path);
    assert.equal(await response.text(), '', path);
  }
  assert.deepEqual(opened, []);
  assert.deepEqual(asked, []);
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

/** The rows of a search's result, as text, with the highlights dropped. */
const found = (html: string) => rows(html.replace(/<\/?mark>/g, ''));

/** The page for `/?repo=<repo>&q=<q>`. */
async function search(repo: string, q: string) {
  const url = new URL(server.url);
  url.searchParams.set('repo', repo);
  url.searchParams.set('q', q);
  const response = await fetch(url);
  return { status: response.status, html: await response.text() };
}

test('search: the field at the top, under the repository field, then the results', async () => {
  const home = await page();
  assert.match(home.html, /<input id="repo"[^>]*>[\s\S]*<input id="q" name="q" type="text" size="48" value=""/);
  const { html } = await search(FIXTURE, 'commit');
  assert.ok(html.indexOf('id="q"') < html.indexOf('class="skills"'));
  assert.match(html, /<input id="q" name="q" type="text" size="48" value="commit"/);
});

test('search: by name or description, ignoring case, the matches highlighted and renumbered', async () => {
  // "commit" is in the name of commits and in the description of code-style ("committing").
  const { status, html } = await search(FIXTURE, '  COMMIT ');
  assert.equal(status, 200);
  assert.deepEqual(found(html), [
    "1 code-style Follow the project&#39;s code style. Use before committing Kotlin or Java changes.",
    '2 commits Write commit messages the way this repository does. Use for every commit.',
  ]);
  assert.ok(html.includes('Use before <mark>commit</mark>ting Kotlin'));
  assert.ok(html.includes('><mark>commit</mark>s</a>'));
  // Every match in a text, keeping its own case.
  assert.ok(html.includes('Write <mark>commit</mark> messages the way this repository does. Use for every <mark>commit</mark>.'));
  assert.match(html, /<h2 class="repo"><a [^>]*>fixture<\/a> &middot; 3 skills<\/h2>/);
  assert.match(html, /<div class="search">2 of 3 skills match &quot;<b>COMMIT<\/b>&quot; &middot; <a href="\/\?repo=[^"]*fixture">show all<\/a><\/div>/);
  // The counter counts the skills on the page.
  assert.match(html, /<span class="counter">(<span>0<\/span>){5}<span>2<\/span><\/span>/);
  // A skill without a description matches by its name.
  const one = await search(FIXTURE, 'checklist');
  assert.deepEqual(found(one.html), ['1 release-checklist (no description)']);
  assert.match(one.html, /release-<mark>checklist<\/mark><\/a>/);
  assert.match(one.html, /1 of 3 skills matches/);
});

test('search: no match → No skills match, the warnings still shown', async () => {
  const { status, html } = await search(FIXTURE, 'guestbook');
  assert.equal(status, 200);
  assert.deepEqual(found(html), []);
  assert.match(html, /<p class="none">No skills match &quot;guestbook&quot;<\/p>/);
  assert.match(html, /0 of 3 skills match/);
  assert.match(html, /class="warnings"/);
  assert.match(html, /<span class="counter">(<span>0<\/span>){6}<\/span>/);
});

test('search: empty shows every skill; without a repository it is the home page', async () => {
  const all = await search(FIXTURE, '   ');
  assert.equal(found(all.html).length, 3);
  assert.doesNotMatch(all.html, /<mark>|class="search"/);
  assert.equal((await search('', 'commit')).html, (await page()).html);
});

test('search: the text is literal and HTML-escaped, in the matches and in the field', async (t) => {
  const root = project(t, {
    '.claude/skills/a/SKILL.md': '---\nname: "a.b <i> & (c)"\ndescription: "Costs $5 * 2."\n---\n',
    '.claude/skills/b/SKILL.md': '---\nname: axb\ndescription: Nothing special.\n---\n',
  });
  // "." is not "any character": axb does not match.
  const dot = await search(root, 'a.b');
  assert.deepEqual(found(dot.html).map((row) => row.split(' ')[1]), ['a.b']);
  assert.ok(dot.html.includes('<mark>a.b</mark> &#60;i&#62; &#38; (c)'));
  const tag = await search(root, '<i> & (');
  assert.doesNotMatch(tag.html, /<i>/);
  assert.ok(tag.html.includes('a.b <mark>&#60;i&#62; &#38; (</mark>c)'));
  assert.ok(tag.html.includes('value="&#60;i&#62; &#38; ("'));
  const symbols = await search(root, '$5 *');
  assert.ok(symbols.html.includes('Costs <mark>$5 *</mark> 2.'));
});

test('search: a failed scan keeps the search in the field', async () => {
  const { status, html } = await search(join(FIXTURE, 'no-such-directory'), 'x"y');
  assert.equal(status, 400);
  assert.ok(html.includes('id="q" name="q" type="text" size="48" value="x&#34;y"'));
});
