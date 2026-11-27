// The web view: a small Node HTTP server that scans on request and answers with one HTML page
// (src/page.ts). Like the CLI, a thin client over the core; nothing is stored.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { clusterSkills, type Model } from './core/cluster.ts';
import { AtlasError } from './core/errors.ts';
import { openOrganization, type GitHubOptions } from './core/github.ts';
import { scanOrganization } from './core/organization.ts';
import { rateLimit, type RateLimit } from './core/ratelimit.ts';
import { scan, type Source } from './core/scan.ts';
import { organizationEnd, organizationProgress, organizationStart, renderPage, type PageState } from './page.ts';

export type WebOptions = {
  /** Opens what the user asked to scan, as the CLI does. */
  open(input: string): Promise<Source>;
  /** GitHub, for the organization page; its fetch goes through `rateLimit`. */
  github: GitHubOptions;
  /** The limiter all organization scans share, since GitHub's limits are the same for all of them. */
  rateLimit?: RateLimit;
  /** The model that clusters skills, for `/cluster`. */
  model?: Model;
  port: number;
  /** Local only by default: the page can scan this machine's directories. */
  host?: string;
};

/** GitHub for the organization page, and the rate limiter its requests share. */
type GitHub = GitHubOptions & { limit: RateLimit };

export type WebServer = { url: string; close(): Promise<void> };

export async function serveWeb(options: WebOptions): Promise<WebServer> {
  const github = { ...options.github, limit: options.rateLimit ?? rateLimit() };
  const server = createServer((request, response) => {
    handle(request, response, options.open, github, options.model).catch((error) => {
      if (!response.headersSent) send(response, 500, { kind: 'error', input: '', query: '', message: `Unexpected error: ${String(error)}` });
      else response.end();
    });
  });
  const host = options.host ?? '127.0.0.1';
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, host, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://${host}:${port}/`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function handle(request: IncomingMessage, response: ServerResponse, open: WebOptions['open'], github: GitHub, model?: Model) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' }).end();
    return;
  }
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname === '/org') return organization(response, url.searchParams.get('org')?.trim() ?? '', github);
  if (url.pathname === '/cluster') {
    const input = url.searchParams.get('repo')?.trim() ?? '';
    if (!input) return send(response, 200, { kind: 'home' });
    try {
      if (!model) throw new AtlasError('Clustering needs a model: start the web view from the command line, with claude installed');
      const result = await scan(await open(input));
      send(response, 200, { kind: 'cluster', input, result, clustering: await clusterSkills(result.skills, model) });
    } catch (error) {
      if (!(error instanceof AtlasError)) throw error;
      send(response, 400, { kind: 'error', input, query: '', message: error.message });
    }
    return;
  }
  if (url.pathname !== '/') return send(response, 404, { kind: 'not-found', path: url.pathname });
  const input = url.searchParams.get('repo')?.trim() ?? '';
  const query = url.searchParams.get('q')?.trim() ?? '';
  if (!input) return send(response, 200, { kind: 'home' });
  try {
    const result = await scan(await open(input));
    send(response, 200, { kind: 'result', input, query, result });
  } catch (error) {
    if (!(error instanceof AtlasError)) throw error;
    send(response, 400, { kind: 'error', input, query, message: error.message });
  }
}

/**
 * The organization page: its repositories at once, then each scan's outcome as it finishes, on the
 * same response. Once the page is closed, no more requests are sent to GitHub.
 */
async function organization(response: ServerResponse, input: string, { limit, ...options }: GitHub) {
  if (!input) return send(response, 200, { kind: 'org-home' });
  const closed = new AbortController();
  response.once('close', () => closed.abort());
  // Checked as each request is sent, after any wait for the rate limit.
  const github: GitHubOptions = {
    ...options,
    fetch: limit.wrap((url, init) => (closed.signal.aborted ? Promise.reject(new Error('the page was closed')) : options.fetch(url, init))),
  };
  let found;
  try {
    found = await openOrganization(input, github);
  } catch (error) {
    if (!(error instanceof AtlasError)) throw error;
    return send(response, 400, { kind: 'org-error', input, message: error.message });
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  response.write(organizationStart(found, input));
  let done = 0;
  const total = found.repositories.length;
  const scans = await scanOrganization(found, github, (index, scanned) => {
    done++;
    if (!response.destroyed) response.write(organizationProgress(index, scanned, done, total));
  });
  if (!response.destroyed) response.end(organizationEnd(scans));
}

function send(response: ServerResponse, status: number, state: PageState) {
  response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  response.end(renderPage(state));
}
