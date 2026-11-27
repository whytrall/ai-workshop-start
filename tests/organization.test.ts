// spec/web.md's organization page, on what a real server streams, with GitHub answered from a
// recording below; and the GitHub rate limits it respects (src/core/ratelimit.ts), on a fake clock.
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { AtlasError } from '../src/core/errors.ts';
import { openOrganization, type Fetch } from '../src/core/github.ts';
import { rateLimit } from '../src/core/ratelimit.ts';
import { replay, type Recording } from '../src/core/replay.ts';
import { cssString } from '../src/page.ts';
import { serveWeb } from '../src/web.ts';
import { ALIAS_BOMB, open } from './helpers.ts';

const API = 'https://api.github.com';
const SHA = 'abc123';

type FakeRepo = { files: Record<string, string> } | { status: number; message: string };

/** What GitHub answers, without a token (through the tree), for an organization with these repositories. */
function organization(org: string, repos: Record<string, FakeRepo>): Recording {
  const names = Object.keys(repos);
  const recording: Recording = {
    [`${API}/orgs/${org}/repos?sort=full_name&per_page=100&page=1`]: {
      status: 200,
      body: names.map((name) => ({ name, full_name: `${org}/${name}`, html_url: `https://github.com/${org}/${name}` })),
    },
  };
  for (const [name, repo] of Object.entries(repos)) {
    const id = `${org}/${name}`;
    if ('status' in repo) {
      recording[`${API}/repos/${id}`] = { status: repo.status, body: { message: repo.message } };
      continue;
    }
    recording[`${API}/repos/${id}`] = { status: 200, body: { full_name: id, default_branch: 'main' } };
    recording[`${API}/repos/${id}/commits/main`] = { status: 200, body: { sha: SHA } };
    recording[`${API}/repos/${id}/git/trees/${SHA}?recursive=1`] = {
      status: 200,
      body: { truncated: false, tree: Object.keys(repo.files).map((path) => ({ path, mode: '100644', type: 'blob', sha: 'x' })) },
    };
    for (const [path, text] of Object.entries(repo.files)) recording[`https://raw.githubusercontent.com/${id}/${SHA}/${path}`] = { status: 200, body: text };
  }
  return recording;
}

const EXAMPLE = organization('Example', {
  alpha: { files: { '.claude/skills/one/SKILL.md': '---\ndescription: One.\n---\n', '.agents/skills/two/SKILL.md': '---\ndescription: Two.\n---\n' } },
  beta: { files: { 'README.md': '# Beta\n', '.github/skills/broken/SKILL.md': '---\ndescription: a: b: c\n---\n' } },
  gamma: { status: 500, message: 'Server down </style><script>alert(1)</script>' },
});

/** A server whose organization page asks `fetch`. */
async function server(t: TestContext, fetch: Fetch, options: Parameters<typeof rateLimit>[0] = {}) {
  const web = await serveWeb({ open, github: { fetch }, rateLimit: rateLimit(options), port: 0 });
  t.after(() => web.close());
  return web;
}

async function get(base: string, org?: string) {
  const url = new URL('/org', base);
  if (org !== undefined) url.searchParams.set('org', org);
  const response = await fetch(url);
  return { status: response.status, html: await response.text() };
}

/** The repositories table's rows, as text. */
function rows(html: string): string[] {
  return [...html.matchAll(/<tr class="(?:even|odd)" id="repo-\d+">([\s\S]*?)<\/tr>/g)].map((m) =>
    m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  );
}

/** What the page last says about a repository: ok or failed, and its detail; undefined while it scans. */
function outcome(html: string, index: number): { state: string; detail: string } | undefined {
  const match = new RegExp(`#repo-${index} \\.(ok|failed)\\{display:inline\\}#repo-${index} \\.detail::after\\{content:("[^"]*")\\}`).exec(html);
  return match ? { state: match[1], detail: unescapeCss(match[2]) } : undefined;
}

/** The progress bar's last width and text. */
function progress(html: string): { width: string; text: string } {
  const all = [...html.matchAll(/\.progress-done\{width:(\d+%)\}\.progress-text::after\{content:("[^"]*")\}/g)];
  const last = all.at(-1)!;
  return { width: last[1], text: unescapeCss(last[2]) };
}

function unescapeCss(quoted: string): string {
  return quoted.slice(1, -1).replace(/\\([0-9a-f]+) /g, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)));
}

/** A promise and its resolve, to hold a request until the test lets it go. */
function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { open, opened };
}

/** Reads the streamed page until `pattern` appears; returns what was read so far. */
async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, read: { text: string }, pattern: RegExp) {
  const decoder = new TextDecoder();
  while (!pattern.test(read.text)) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`the page ended without ${pattern}`);
    read.text += decoder.decode(value, { stream: true });
  }
  return read.text;
}

test('/org: the organization form, no scripts; every page links to it', async (t) => {
  const web = await server(t, replay({}));
  const home = await get(web.url);
  assert.equal(home.status, 200);
  assert.match(home.html, /<form id="scan" class="scan" method="get" action="\/org">/);
  assert.match(home.html, /<input id="org" name="org" type="text" size="48" value=""/);
  assert.doesNotMatch(home.html, /<script/i);
  assert.match(home.html, /<a href="\/org">&raquo; Scan an organization<\/a>/);
  assert.equal((await get(web.url, '  ')).html, home.html);
  const repoHome = await (await fetch(web.url)).text();
  assert.match(repoHome, /<a href="\/org">&raquo; Scan an organization<\/a>/);
});

test('/org?org=: the repositories, each scanned with its own outcome; the bar at 100%; the failures in full', async (t) => {
  const web = await server(t, replay(EXAMPLE));
  const { status, html } = await get(web.url, 'Example');
  assert.equal(status, 200);
  assert.match(html, /<title>Example - Skill Atlas<\/title>/);
  assert.match(html, /<h2 class="repo"><a href="https:\/\/github.com\/Example">Example<\/a> &middot; 3 repositories<\/h2>/);
  assert.deepEqual(rows(html), ['1 alpha scanning... OK! FAILED', '2 beta scanning... OK! FAILED', '3 gamma scanning... OK! FAILED']);
  assert.ok(html.includes('<a href="/?repo=https%3A%2F%2Fgithub.com%2FExample%2Falpha">alpha</a>'));
  assert.deepEqual(outcome(html, 0), { state: 'ok', detail: '2 skills' });
  assert.deepEqual(outcome(html, 1), { state: 'ok', detail: '1 skill, 1 warning' });
  assert.deepEqual(outcome(html, 2), {
    state: 'failed',
    detail: `GitHub answered 500 for ${API}/repos/Example/gamma: Server down </style><script>alert(1)</script>`,
  });
  assert.deepEqual(progress(html), { width: '100%', text: '3 of 3 scanned (100%) - done!' });
  assert.match(html, /<div class="done">Done! 3 repositories scanned: 2 OK, 1 failed &middot; 3 skills<\/div>/);
  assert.match(html, /<li><b>Example\/gamma<\/b>: GitHub answered 500 for .*Server down &#60;\/style&#62;&#60;script&#62;/);
  // Everything GitHub said is escaped: in the styles as in the text.
  assert.doesNotMatch(html, /<script/i);
  assert.equal(html.match(/<\/style>/g)!.length, html.match(/<style>/g)!.length);
  assert.match(html, /Skills on this page: <span class="counter">(<span>0<\/span>){5}<span>3<\/span><\/span>/);
  assert.match(html, /<\/html>\n$/);
});

test('/org?org=: a YAML alias bomb in one repository → that repository is ok with a warning, not an unexpected error', async (t) => {
  const recording = organization('Bombed', {
    mined: { files: { '.claude/skills/x/SKILL.md': ALIAS_BOMB, '.claude/skills/ok/SKILL.md': '---\ndescription: Fine.\n---\n' } },
  });
  const web = await server(t, replay(recording));
  const { status, html } = await get(web.url, 'Bombed');
  assert.equal(status, 200);
  assert.deepEqual(outcome(html, 0), { state: 'ok', detail: '2 skills, 1 warning' });
  assert.match(html, /<div class="done">Done! 1 repository scanned: 1 OK, 0 failed &middot; 2 skills<\/div>/);
});

test('the scans run in parallel, and the page shows each one as it finishes', async (t) => {
  const started = new Set<string>();
  const allStarted = gate();
  const seen = gate();
  const betaDone = gate();
  t.after(() => [allStarted, seen, betaDone].forEach((g) => g.open()));
  const live = replay(EXAMPLE);
  const web = await server(t, async (url, init) => {
    const repo = /\/repos\/Example\/(\w+)$/.exec(url)?.[1];
    if (repo) {
      started.add(repo);
      if (started.size === 3) allStarted.open();
      await allStarted.opened; // every scan has started before any goes on: they are in parallel
      await seen.opened;
    }
    if (url.includes('/repos/Example/alpha/')) await betaDone.opened;
    return live(url, init);
  });
  const response = await fetch(new URL('/org?org=Example', web.url));
  const reader = response.body!.getReader();
  const read = { text: '' };

  // At once: the list, every repository scanning, the bar at zero.
  let html = await readUntil(reader, read, /<\/table>/);
  assert.equal(rows(html).length, 3);
  assert.deepEqual(progress(html), { width: '0%', text: '0 of 3 scanned (0%)' });
  assert.equal(outcome(html, 0), undefined);
  await allStarted.opened;
  seen.open();

  // beta and gamma finish while alpha is held: the bar moves, alpha still scans.
  html = await readUntil(reader, read, /2 of 3 scanned/);
  assert.equal(outcome(html, 0), undefined);
  assert.equal(outcome(html, 1)?.state, 'ok');
  assert.equal(outcome(html, 2)?.state, 'failed');
  assert.deepEqual(progress(html), { width: '66%', text: '2 of 3 scanned (66%)' });
  assert.doesNotMatch(html, /class="done"/);

  betaDone.open();
  html = await readUntil(reader, read, /<\/html>/);
  assert.deepEqual(outcome(html, 0), { state: 'ok', detail: '2 skills' });
  assert.equal(progress(html).width, '100%');
});

test('an organization with no repositories → No repositories here... yet!', async (t) => {
  const web = await server(t, replay(organization('Empty', {})));
  const { status, html } = await get(web.url, 'https://github.com/Empty');
  assert.equal(status, 200);
  assert.match(html, /<a href="https:\/\/github.com\/Empty">Empty<\/a> &middot; 0 repositories/);
  assert.match(html, /<p class="none">No repositories here\.\.\. yet!<\/p>/);
  assert.deepEqual(progress(html), { width: '100%', text: '0 of 0 scanned (100%) - done!' });
  assert.match(html, /Done! 0 repositories scanned: 0 OK, 0 failed &middot; 0 skills/);
});

test('not an organization name, or no such organization → the message in an error box, status 400', async (t) => {
  const web = await server(t, replay({ [`${API}/orgs/nobody/repos?sort=full_name&per_page=100&page=1`]: { status: 404, body: { message: 'Not Found' } } }));
  const bad = await get(web.url, 'not/an org');
  assert.equal(bad.status, 400);
  assert.match(bad.html, /<div class="error"><div class="error-title">ERROR!!!<\/div>Not a GitHub organization: not\/an org<\/div>/);
  assert.match(bad.html, /action="\/org"/);
  assert.ok(bad.html.includes('value="not/an org"'));

  const missing = await get(web.url, 'nobody');
  assert.equal(missing.status, 400);
  assert.match(missing.html, /Organization not found: https:\/\/github\.com\/nobody<\/div>/);
});

test('the organization is listed page by page, 100 a page', async () => {
  const repo = (n: number) => ({ name: `r${n}`, full_name: `Big/r${n}`, html_url: `https://github.com/Big/r${n}` });
  const found = await openOrganization('Big', {
    fetch: replay({
      [`${API}/orgs/Big/repos?sort=full_name&per_page=100&page=1`]: { status: 200, body: Array.from({ length: 100 }, (_, n) => repo(n)) },
      [`${API}/orgs/Big/repos?sort=full_name&per_page=100&page=2`]: { status: 200, body: [repo(100)] },
    }),
  });
  assert.equal(found.repositories.length, 101);
  assert.deepEqual(found.repositories[100], { id: 'Big/r100', name: 'r100', url: 'https://github.com/Big/r100' });
});

test('closing the page sends GitHub nothing more', async (t) => {
  const asked: string[] = [];
  const held = gate();
  t.after(held.open);
  const live = replay(EXAMPLE);
  const web = await server(t, async (url, init) => {
    asked.push(url);
    if (/\/repos\/Example\/\w+$/.test(url)) await held.opened;
    return live(url, init);
  });
  const closed = new AbortController();
  const response = await fetch(new URL('/org?org=Example', web.url), { signal: closed.signal });
  await readUntil(response.body!.getReader(), { text: '' }, /<\/table>/);
  closed.abort();
  await new Promise((resolve) => setTimeout(resolve, 50));
  held.open();
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(asked.filter((url) => url.includes('/commits/')), []);
});

// GitHub's rate limits: src/core/ratelimit.ts.

/** A fake clock: sleeping moves it. */
function clock(start = 1_000_000_000_000) {
  const slept: number[] = [];
  let time = start;
  return { now: () => time, sleep: async (ms: number) => void (slept.push(ms), (time += ms)), slept };
}

/** An answer with GitHub's rate-limit headers. */
function answer(status: number, headers: Record<string, string> = {}, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

const budget = (remaining: number, reset: number, resource = 'core') => ({
  'x-ratelimit-resource': resource,
  'x-ratelimit-limit': '60',
  'x-ratelimit-remaining': String(remaining),
  'x-ratelimit-reset': String(reset / 1000),
});

test('rate limit: no requests left until a far reset → not sent, a clear message', async () => {
  const time = clock();
  const reset = time.now() + 3_600_000;
  const sent: string[] = [];
  const limited = rateLimit({ ...time }).wrap(async (url) => (sent.push(url), answer(200, budget(0, reset))));
  await limited(`${API}/repos/a/b`);
  await assert.rejects(limited(`${API}/repos/a/c`), (error) => {
    assert.ok(error instanceof AtlasError);
    assert.equal(error.message, `GitHub rate limit reached; not sent, try again at ${new Date(reset + 1000).toISOString()} (GITHUB_TOKEN raises the limit)`);
    return true;
  });
  assert.deepEqual(sent, [`${API}/repos/a/b`]);
  assert.deepEqual(time.slept, []);
  // Raw files count against no API budget.
  await limited('https://raw.githubusercontent.com/a/b/c/SKILL.md');
  assert.equal(sent.length, 2);
});

test('rate limit: a near reset is waited for, then the request is sent', async () => {
  const time = clock();
  const reset = time.now() + 10_000;
  let calls = 0;
  const limited = rateLimit({ ...time }).wrap(async () => (calls++ ? answer(200, budget(59, reset + 60_000)) : answer(200, budget(0, reset))));
  await limited(`${API}/repos/a/b`);
  assert.equal((await limited(`${API}/repos/a/c`)).status, 200);
  assert.deepEqual(time.slept, [11_000]);
  assert.equal(calls, 2);
});

test('rate limit: the budget is shared, so parallel requests do not overspend it', async () => {
  const time = clock();
  const reset = time.now() + 3_600_000;
  let remaining = 3;
  const sent: string[] = [];
  const limited = rateLimit({ ...time }).wrap(async (url) => (sent.push(url), answer(200, budget(--remaining, reset))));
  await limited(`${API}/repos/a/first`); // GitHub says 2 left
  const results = await Promise.allSettled(['b', 'c', 'd', 'e'].map((name) => limited(`${API}/repos/a/${name}`)));
  assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'fulfilled', 'rejected', 'rejected']);
  assert.equal(sent.length, 3);
});

test('rate limit: each resource has its own budget (code search apart from the rest)', async () => {
  const time = clock();
  const sent: string[] = [];
  const limited = rateLimit({ ...time }).wrap(async (url) =>
    (sent.push(url), url.includes('/search/') ? answer(200, budget(0, time.now() + 3_600_000, 'code_search')) : answer(200)),
  );
  await limited(`${API}/search/code?q=x`);
  await assert.rejects(limited(`${API}/search/code?q=y`), /rate limit reached/);
  await limited(`${API}/repos/a/b`);
  assert.equal(sent.length, 2);
});

test('rate limit: GitHub asks to retry after a while → everyone waits, then it is retried', async () => {
  const time = clock();
  let calls = 0;
  const limited = rateLimit({ ...time }).wrap(async () => (calls++ ? answer(200) : answer(429, { 'retry-after': '2' })));
  assert.equal((await limited(`${API}/repos/a/b`)).status, 200);
  assert.deepEqual(time.slept, [2_000]);
  assert.equal(calls, 2);
});

test('rate limit: a secondary rate limit without retry-after → a minute, then retried; any other 403 is not', async () => {
  const time = clock();
  const answers = [answer(403, {}, { message: 'You have exceeded a secondary rate limit.' }), answer(200), answer(403, {}, { message: 'Resource not accessible' })];
  const limited = rateLimit({ ...time }).wrap(async () => answers.shift()!);
  assert.equal((await limited(`${API}/repos/a/b`)).status, 200);
  assert.deepEqual(time.slept, [60_000]);
  const forbidden = await limited(`${API}/repos/a/c`);
  assert.equal(forbidden.status, 403);
  assert.deepEqual(await forbidden.json(), { message: 'Resource not accessible' });
  assert.deepEqual(time.slept, [60_000]);
});

test('rate limit: a rate-limited answer with a far reset is given back, as GitHub said it', async () => {
  const time = clock();
  const limited = rateLimit({ ...time }).wrap(async () => answer(403, budget(0, time.now() + 3_600_000), { message: 'API rate limit exceeded' }));
  const response = await limited(`${API}/repos/a/b`);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { message: 'API rate limit exceeded' });
  assert.deepEqual(time.slept, []);
});

test('rate limit: few requests in flight at once', async () => {
  let active = 0;
  let most = 0;
  const limited = rateLimit({ concurrency: 3 }).wrap(async () => {
    most = Math.max(most, ++active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return answer(200);
  });
  await Promise.all(Array.from({ length: 12 }, (_, n) => limited(`${API}/repos/a/${n}`)));
  assert.equal(most, 3);
});

test('the organization page under a spent rate limit: what is left is spent, the rest fails without being sent', async (t) => {
  const reset = Date.now() + 3_600_000;
  const live = replay(EXAMPLE);
  let left = 4; // the listing, then one request for each repository
  const sent: string[] = [];
  const web = await server(t, async (url, init) => {
    const answered = await live(url, init);
    if (!url.startsWith(API)) return answered;
    sent.push(url);
    return new Response(answered.body, { status: answered.status, headers: budget(--left, reset) });
  });
  const { status, html } = await get(web.url, 'Example');
  assert.equal(status, 200);
  assert.deepEqual(sent, [
    `${API}/orgs/Example/repos?sort=full_name&per_page=100&page=1`,
    `${API}/repos/Example/alpha`,
    `${API}/repos/Example/beta`,
    `${API}/repos/Example/gamma`,
  ]);
  for (const index of [0, 1]) {
    assert.equal(outcome(html, index)?.state, 'failed');
    assert.match(outcome(html, index)!.detail, /^GitHub rate limit reached; not sent, try again at /);
  }
  assert.match(outcome(html, 2)!.detail, /^GitHub answered 500/);
  assert.match(html, /Done! 3 repositories scanned: 0 OK, 3 failed/);
});

test('CSS strings escape everything that could end them', () => {
  assert.equal(cssString('a "b" \\ </style>'), '"a \\22 b\\22  \\5c  \\3c \\2f style\\3e "');
});
