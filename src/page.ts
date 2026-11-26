// The web view's HTML: one page, styled like a homepage from the early 2000s. Pure strings, no Node
// APIs and no scripts: the server renders it, the browser only shows it. Everything is embedded,
// so the page loads nothing else.
import { skillLink, type Skill } from './core/model.ts';
import type { Organization } from './core/github.ts';
import type { RepositoryScan } from './core/organization.ts';
import type { ScanResult } from './core/scan.ts';

/** What the page shows: a form alone, a scan's result, or why the scan failed. */
export type PageState =
  | { kind: 'home' }
  | { kind: 'result'; input: string; query: string; result: ScanResult }
  | { kind: 'error'; input: string; query: string; message: string }
  | { kind: 'org-home' }
  | { kind: 'org-error'; input: string; message: string }
  | { kind: 'not-found'; path: string };

export function renderPage(state: PageState): string {
  const input = 'input' in state ? state.input : '';
  const query = 'query' in state ? state.query : '';
  const title = state.kind === 'result' ? `${state.result.repository.id} - Skill Atlas` : 'Skill Atlas';
  const kind = state.kind === 'org-home' || state.kind === 'org-error' ? 'org' : 'repo';
  return `${top(title, form(kind, input, query))}
  ${content(state)}
${bottom(state.kind === 'result' ? filterSkills(state.result.skills, query).length : 0)}`;
}

/** Everything above what the page shows, up to its main cell. */
function top(title: string, form: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<meta name="generator" content="Skill Atlas (Notepad)">
<style>${STYLE}</style>
</head>
<body>
<table class="frame" cellspacing="0" cellpadding="0" align="center">
<tr><td colspan="2" class="header">
  <h1 class="wordart">~*~ Skill Atlas ~*~</h1>
  <marquee scrollamount="5">*** Welcome to the Skill Atlas!!! *** Every SKILL.md in a repository, on one page *** Sign my... no guestbook, nothing is stored ***</marquee>
</td></tr>
<tr>
<td class="nav">
  <div class="nav-title">:: Navigation ::</div>
  <a href="/">&raquo; Home</a>
  <a href="/#scan">&raquo; Scan a repo</a>
  <a href="/org">&raquo; Scan an organization</a>
  <a href="/?repo=https%3A%2F%2Fgithub.com%2FJetBrains%2Fkotlin">&raquo; Cool site: Kotlin</a>
  <div class="nav-title">:: Status ::</div>
  <div class="construction">UNDER<br>CONSTRUCTION</div>
  <div class="nav-note">Best viewed in<br>Netscape Navigator 4<br>at 800x600</div>
</td>
<td class="main">
  ${form}`;
}

/** The main cell's end, and the footer with the counter of the skills on the page. */
function bottom(skills: number): string {
  return `</td>
</tr>
<tr><td colspan="2" class="footer">
  ${counter(skills)}
  <div class="webring">&laquo; Prev | <b>The Agent Skills Webring</b> | Next &raquo;</div>
  <div class="small">Made with Notepad &middot; No cookies, no guestbook, nothing stored &middot; &copy; Skill Atlas</div>
</td></tr>
</table>
</body>
</html>
`;
}

/** The form: a repository and a search of the skills at `/`, an organization at `/org`. */
function form(kind: 'repo' | 'org', input: string, query = ''): string {
  if (kind === 'org') {
    return `<form id="scan" class="scan" method="get" action="/org">
    <fieldset>
      <legend>Scan an organization</legend>
      <label for="org">GitHub organization:</label><br>
      <input id="org" name="org" type="text" size="48" value="${escapeHtml(input)}" placeholder="JetBrains">
      <input type="submit" value="Scan!">
    </fieldset>
  </form>`;
  }
  return `<form id="scan" class="scan" method="get" action="/">
    <fieldset>
      <legend>Scan a repository</legend>
      <label for="repo">GitHub URL or directory:</label><br>
      <input id="repo" name="repo" type="text" size="48" value="${escapeHtml(input)}" placeholder="https://github.com/owner/repo">
      <input type="submit" value="Scan!"><br>
      <label for="q">Search the skills:</label><br>
      <input id="q" name="q" type="text" size="48" value="${escapeHtml(query)}" placeholder="name or description">
    </fieldset>
  </form>`;
}

function content(state: PageState): string {
  switch (state.kind) {
    case 'home':
      return `<div class="welcome"><img alt="" class="spinner" src="${STAR}"> Type a <b>GitHub URL</b> or a <b>directory</b> above and press <b>Scan!</b> <img alt="" class="spinner" src="${STAR}"></div>`;
    case 'org-home':
      return `<div class="welcome"><img alt="" class="spinner" src="${STAR}"> Type a <b>GitHub organization</b> above and press <b>Scan!</b> Every repository is scanned at once <img alt="" class="spinner" src="${STAR}"></div>`;
    case 'error':
    case 'org-error':
      return `<div class="error"><div class="error-title">ERROR!!!</div>${escapeHtml(state.message)}</div>`;
    case 'not-found':
      return `<div class="error"><div class="error-title">404 - Page Not Found</div>There is no page at ${escapeHtml(state.path)}. <a href="/">Go home</a>.</div>`;
    case 'result':
      return result(state.result, state.input, state.query);
  }
}

function result({ repository, skills, warnings }: ScanResult, input: string, query: string): string {
  const count = `${skills.length} ${skills.length === 1 ? 'skill' : 'skills'}`;
  const commit = repository.commit ? `<div class="commit">Scanned commit: <tt>${escapeHtml(repository.commit)}</tt></div>` : '';
  const shown = filterSkills(skills, query);
  const rows = shown.map((skill, index) => row(repository, skill, index, query)).join('\n');
  const searched = query && skills.length
    ? `<div class="search">${shown.length} of ${count} ${shown.length === 1 ? 'matches' : 'match'} &quot;<b>${escapeHtml(query)}</b>&quot; &middot; <a href="/?repo=${escapeHtml(encodeURIComponent(input))}">show all</a></div>`
    : '';
  const table = shown.length
    ? `<table class="skills" border="1" cellspacing="0" cellpadding="4">
<tr><th>#</th><th>Skill</th><th>Description</th></tr>
${rows}
</table>`
    : skills.length
      ? `<p class="none">No skills match &quot;${escapeHtml(query)}&quot;</p>`
      : `<p class="none">No skills here... yet!</p>`;
  const warningList = warnings.length
    ? `<div class="warnings"><span class="blink">!! Warning !!</span><ul>${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul></div>`
    : '';
  return `<h2 class="repo"><a href="${escapeHtml(repository.url)}">${escapeHtml(repository.id)}</a> &middot; ${count}</h2>
${commit}
${searched}
${table}
${warningList}`;
}

function row(repository: ScanResult['repository'], skill: Skill, index: number, query: string): string {
  const link = skillLink(repository, skill);
  const copies = skill.copies.length ? `<div class="copies">also in ${skill.copies.map(escapeHtml).join(', ')}</div>` : '';
  return `<tr class="${index % 2 ? 'odd' : 'even'}">
<td class="n">${index + 1}</td>
<td class="name"><a href="${escapeHtml(link)}">${highlight(skill.name, query)}</a>${copies}</td>
<td class="description">${skill.description ? highlight(skill.description, query) : '<i>(no description)</i>'}</td>
</tr>`;
}

/** The skills whose name or description contains the query, ignoring case; all of them for no query. */
export function filterSkills(skills: Skill[], query: string): Skill[] {
  if (!query) return skills;
  const pattern = matcher(query);
  return skills.filter((skill) => pattern.test(skill.name) || pattern.test(skill.description));
}

/** The text, HTML-escaped, with every match of the query, ignoring case, in a <mark>. */
export function highlight(text: string, query: string): string {
  if (!query) return escapeHtml(text);
  return text
    .split(matcher(query, true))
    .map((part, index) => (index % 2 ? `<mark>${escapeHtml(part)}</mark>` : escapeHtml(part)))
    .join('');
}

/** The query as a literal, case-insensitive pattern; captured, for split to keep the matches. */
function matcher(query: string, capture = false): RegExp {
  const literal = query.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  return new RegExp(capture ? `(${literal})` : literal, 'iu');
}

/** The odometer counts the skills on this page: there is nothing stored to count visitors with. */
function counter(count: number): string {
  const digits = String(count).padStart(6, '0').split('').map((d) => `<span>${d}</span>`).join('');
  return `<div class="counter-box">Skills on this page: <span class="counter">${digits}</span></div>`;
}

/**
 * The organization page, sent in parts as its scans finish: `organizationStart` with the progress
 * bar and every repository scanning, one `organizationProgress` per finished scan, and
 * `organizationEnd`. There are no scripts: each part after the first is a style that moves the
 * bar and turns a repository's indicator to OK or FAILED; later styles override earlier ones.
 */
export function organizationStart(organization: Organization, input: string): string {
  const total = organization.repositories.length;
  const rows = organization.repositories
    .map((repository, index) => {
      const link = `/?repo=${encodeURIComponent(repository.url)}`;
      return `<tr class="${index % 2 ? 'odd' : 'even'}" id="repo-${index}">
<td class="n">${index + 1}</td>
<td class="name"><a href="${escapeHtml(link)}">${escapeHtml(repository.name)}</a></td>
<td class="state"><span class="scanning"><img alt="" class="spinner" src="${STAR}"> scanning...</span><span class="ok">OK!</span><span class="failed">FAILED</span></td>
<td class="detail"></td>
</tr>`;
    })
    .join('\n');
  const table = total
    ? `<table class="skills repos" border="1" cellspacing="0" cellpadding="4">
<tr><th>#</th><th>Repository</th><th>Status</th><th>Result</th></tr>
${rows}
</table>`
    : `<p class="none">No repositories here... yet!</p>`;
  return `${top(`${organization.id} - Skill Atlas`, form('org', input))}
<h2 class="repo"><a href="${escapeHtml(organization.url)}">${escapeHtml(organization.id)}</a> &middot; ${plural(total, 'repository', 'repositories')}</h2>
<div class="progress"><div class="progress-bar"><div class="progress-done"></div></div><div class="progress-text"></div></div>
${progress(0, total)}
${table}
`;
}

/** One finished scan: its indicator, what it found or why it failed, and the bar. */
export function organizationProgress(index: number, scanned: RepositoryScan, done: number, total: number): string {
  const row = `#repo-${index}`;
  const [state, detail] =
    'result' in scanned
      ? ['ok', [plural(scanned.result.skills.length, 'skill', 'skills'), ...(scanned.result.warnings.length ? [plural(scanned.result.warnings.length, 'warning', 'warnings')] : [])].join(', ')]
      : ['failed', scanned.error];
  return `<style>${row} .scanning{display:none}${row} .${state}{display:inline}${row} .detail::after{content:${cssString(detail)}}</style>
${progress(done, total)}
`;
}

/** Every scan is done: the totals, the failures in full, and the footer. */
export function organizationEnd(scans: RepositoryScan[]): string {
  const failed = scans.flatMap((scanned) => ('error' in scanned ? [scanned] : []));
  const skills = scans.reduce((sum, scanned) => sum + ('result' in scanned ? scanned.result.skills.length : 0), 0);
  const failures = failed.length
    ? `<div class="warnings"><span class="blink">!! Failed !!</span><ul>${failed.map((f) => `<li><b>${escapeHtml(f.repository.id)}</b>: ${escapeHtml(f.error)}</li>`).join('')}</ul></div>`
    : '';
  return `<div class="done">Done! ${plural(scans.length, 'repository', 'repositories')} scanned: ${scans.length - failed.length} OK, ${failed.length} failed &middot; ${plural(skills, 'skill', 'skills')}</div>
${failures}
${bottom(skills)}`;
}

/** The progress bar at `done` of `total`. */
function progress(done: number, total: number): string {
  const percent = total ? Math.floor((done * 100) / total) : 100;
  const text = `${done} of ${total} scanned (${percent}%)${done === total ? ' - done!' : ''}`;
  return `<style>.progress-done{width:${percent}%}.progress-text::after{content:${cssString(text)}}</style>`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** A quoted CSS string: everything but letters, digits and spaces escaped, so nothing ends the style. */
export function cssString(text: string): string {
  return `"${text.replace(/[^A-Za-z0-9 ]/gu, (c) => `\\${c.codePointAt(0)!.toString(16)} `)}"`;
}

/** HTML-escaped text, safe in element content and quoted attributes. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** A little yellow star, embedded. */
const STAR =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><polygon fill="#ff0" stroke="#f60" points="12,1 15,9 23,9 17,14 19,23 12,18 5,23 7,14 1,9 9,9"/></svg>',
  );

const STYLE = `
body {
  margin: 12px; color: #ffff99; font-family: Verdana, "Comic Sans MS", Tahoma, sans-serif; font-size: 13px;
  background-color: #000033;
  background-image:
    radial-gradient(1px 1px at 20px 30px, #fff, transparent),
    radial-gradient(1px 1px at 80px 120px, #ccf, transparent),
    radial-gradient(2px 2px at 150px 60px, #fff, transparent),
    radial-gradient(1px 1px at 200px 170px, #ffc, transparent);
  background-size: 230px 200px;
}
a { color: #00ffff; } a:visited { color: #ff99ff; } a:hover { color: #ff0; background: #f0f; }
.frame { width: 780px; border: 4px ridge #c0c0c0; background: #000066; }
.header { background: linear-gradient(#330099, #000066); text-align: center; padding: 8px; border-bottom: 3px groove #c0c0c0; }
.wordart {
  margin: 4px 0; font-family: Impact, "Arial Black", sans-serif; font-size: 44px; letter-spacing: 2px;
  color: #ffcc00; text-shadow: 3px 3px 0 #ff0066, 6px 6px 0 #330066;
}
marquee { color: #00ff00; font-family: "Courier New", monospace; font-weight: bold; }
.nav { width: 170px; vertical-align: top; background: #003366; border-right: 3px groove #c0c0c0; padding: 8px; }
.nav a { display: block; margin: 3px 0; font-weight: bold; }
.nav-title { margin: 10px 0 4px; color: #fff; background: #0066cc; border: 2px outset #3399ff; padding: 2px; text-align: center; font-weight: bold; }
.nav-note { margin-top: 10px; font-size: 10px; color: #ccc; text-align: center; }
.construction {
  margin: 6px 0; padding: 6px; color: #000; font-weight: bold; text-align: center; border: 2px solid #000;
  background: repeating-linear-gradient(45deg, #ffcc00 0 10px, #000 10px 20px);
  text-shadow: 0 0 3px #ffcc00, 0 0 3px #ffcc00, 0 0 3px #ffcc00;
}
.main { vertical-align: top; padding: 12px; }
fieldset { border: 2px groove #c0c0c0; color: #fff; }
legend { color: #ff0; font-weight: bold; }
input[type=text] { font-family: "Courier New", monospace; border: 2px inset #c0c0c0; background: #fff; color: #000; }
input[type=submit] { font-weight: bold; background: #c0c0c0; color: #000; border: 2px outset #fff; cursor: pointer; }
input[type=submit]:active { border-style: inset; }
.welcome { margin-top: 20px; text-align: center; font-size: 15px; }
.spinner { width: 20px; height: 20px; vertical-align: middle; animation: spin 2s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.repo { color: #ff9900; font-family: "Times New Roman", serif; font-size: 22px; border-bottom: 2px dashed #ff9900; }
.commit { font-size: 11px; color: #ccc; margin-bottom: 8px; }
.skills { width: 100%; border-color: #c0c0c0; background: #000033; }
.skills th { background: #660099; color: #fff; border: 2px outset #9966cc; }
.skills tr.even { background: #000044; } .skills tr.odd { background: #001a66; }
.skills td.n { text-align: center; color: #00ff00; font-family: "Courier New", monospace; }
.skills td.name { font-weight: bold; white-space: nowrap; }
.copies { font-weight: normal; font-size: 10px; color: #ccc; }
.description { color: #fff; }
.none { text-align: center; font-size: 16px; }
.search { margin-bottom: 8px; color: #00ff00; }
mark { background: #ff00ff; color: #ffff00; font-weight: bold; }
.warnings { margin-top: 12px; padding: 6px; background: #ffff99; color: #990000; border: 3px double #990000; }
.blink { font-weight: bold; animation: blink 1s steps(1) infinite; }
@keyframes blink { 50% { visibility: hidden; } }
.progress { margin: 8px 0 12px; }
.progress-bar { height: 20px; padding: 2px; background: #c0c0c0; border: 2px inset #fff; }
.progress-done { height: 100%; background: repeating-linear-gradient(90deg, #000080 0 12px, #c0c0c0 12px 14px); }
.progress-text { margin-top: 3px; text-align: center; color: #00ff00; font-family: "Courier New", monospace; font-weight: bold; }
.repos td.state { white-space: nowrap; font-weight: bold; }
.repos .ok, .repos .failed { display: none; }
.repos .ok { color: #00ff00; } .repos .failed { color: #ff3333; }
.repos td.detail { font-size: 11px; color: #fff; }
.done { margin-top: 12px; padding: 6px; text-align: center; font-weight: bold; color: #000; background: #00ff00; border: 3px outset #99ff99; }
.error { margin-top: 12px; padding: 10px; background: #fff; color: #cc0000; border: 4px ridge #ff0000; font-weight: bold; }
.error-title { font-size: 22px; font-family: Impact, sans-serif; }
.error a { color: #0000ee; }
.footer { text-align: center; padding: 8px; border-top: 3px groove #c0c0c0; background: #000033; }
.counter { display: inline-block; background: #000; border: 2px inset #808080; padding: 1px; }
.counter span { display: inline-block; width: 12px; margin: 0 1px; background: #222; color: #ff3300; font-family: "Courier New", monospace; font-weight: bold; }
.webring { margin: 6px 0; color: #ff99ff; }
.small { font-size: 10px; color: #999; }
`;
