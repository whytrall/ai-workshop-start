// The web view: a small Node HTTP server that scans on request and answers with one HTML page
// (src/page.ts). Like the CLI, a thin client over the core; nothing is stored.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AtlasError } from './core/errors.ts';
import { scan, type Source } from './core/scan.ts';
import { renderPage, type PageState } from './page.ts';

export type WebOptions = {
  /** Opens what the user asked to scan, as the CLI does. */
  open(input: string): Promise<Source>;
  port: number;
  /** Local only by default: the page can scan this machine's directories. */
  host?: string;
};

export type WebServer = { url: string; close(): Promise<void> };

export async function serveWeb(options: WebOptions): Promise<WebServer> {
  const server = createServer((request, response) => {
    handle(request, response, options.open).catch((error) => {
      if (!response.headersSent) send(response, 500, { kind: 'error', input: '', message: `Unexpected error: ${String(error)}` });
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

async function handle(request: IncomingMessage, response: ServerResponse, open: WebOptions['open']) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { allow: 'GET, HEAD' }).end();
    return;
  }
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname !== '/') return send(response, 404, { kind: 'not-found', path: url.pathname });
  const input = url.searchParams.get('repo')?.trim() ?? '';
  if (!input) return send(response, 200, { kind: 'home' });
  try {
    const result = await scan(await open(input));
    send(response, 200, { kind: 'result', input, result });
  } catch (error) {
    if (!(error instanceof AtlasError)) throw error;
    send(response, 400, { kind: 'error', input, message: error.message });
  }
}

function send(response: ServerResponse, status: number, state: PageState) {
  response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  response.end(renderPage(state));
}
