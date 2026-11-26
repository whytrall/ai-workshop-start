// GitHub's rate limits, respected by every request that shares one limiter: a cap on requests in
// flight, a budget per rate-limit resource read from GitHub's x-ratelimit-* headers, and a pause
// when GitHub asks for one (retry-after). A wait longer than `maxWait` is not waited: the request
// fails at once, without being sent.
import { AtlasError } from './errors.ts';
import type { Fetch } from './github.ts';

export type RateLimitOptions = {
  /** Requests in flight at most; GitHub asks for few concurrent requests. */
  concurrency?: number;
  /** The longest wait, in milliseconds, before a request is given up instead. */
  maxWait?: number;
  /** The clock and the timer, replaced in tests. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

/** What GitHub said about one resource: requests left in the window, and when it resets (ms). */
type Budget = { limit: number; remaining: number; reset: number };

export type RateLimit = {
  /** `fetch`, through the limiter. */
  wrap(fetch: Fetch): Fetch;
};

/** When GitHub asks to slow down without saying for how long, it asks for at least a minute. */
const SECONDARY_WAIT = 60_000;
/** GitHub's reset times are in whole seconds: one more, so the window has really reset. */
const MARGIN = 1_000;

export function rateLimit(options: RateLimitOptions = {}): RateLimit {
  const concurrency = options.concurrency ?? 8;
  const maxWait = options.maxWait ?? 65_000;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const budgets = new Map<string, Budget>();
  let pausedUntil = 0;
  let active = 0;
  const queue: (() => void)[] = [];

  async function acquire() {
    if (active < concurrency) active++;
    else await new Promise<void>((resolve) => queue.push(resolve)); // the slot is handed over
  }

  function release() {
    const next = queue.shift();
    if (next) next();
    else active--;
  }

  /** Waits for the resource's budget, and spends one request of it. */
  async function spend(resource: string | undefined) {
    for (;;) {
      const budget = resource ? budgets.get(resource) : undefined;
      if (budget && budget.remaining <= 0 && now() >= budget.reset + MARGIN) {
        budget.remaining = budget.limit; // a new window; GitHub's next answer says how it really is
        budget.reset = Infinity;
      }
      const next = until(resource);
      const wait = next - now();
      if (wait <= 0) break;
      if (wait > maxWait) {
        const at = next === Infinity ? 'later' : `at ${new Date(next).toISOString()}`;
        throw new AtlasError(`GitHub rate limit reached; not sent, try again ${at} (GITHUB_TOKEN raises the limit)`);
      }
      await sleep(wait);
    }
    if (resource && budgets.has(resource)) budgets.get(resource)!.remaining--;
  }

  /** What the answer's headers say about its resource's budget. */
  function record(resource: string | undefined, headers: Headers) {
    const name = headers.get('x-ratelimit-resource') ?? resource;
    const limit = Number(headers.get('x-ratelimit-limit'));
    const remaining = Number(headers.get('x-ratelimit-remaining'));
    const reset = Number(headers.get('x-ratelimit-reset')) * 1000;
    if (!name || !headers.has('x-ratelimit-remaining') || !Number.isFinite(remaining) || !Number.isFinite(reset)) return;
    const known = budgets.get(name);
    // Answers arrive out of order: within one window, the lowest count is the latest.
    if (!known || reset > known.reset || known.reset === Infinity) budgets.set(name, { limit: limit || remaining, remaining, reset });
    else if (reset === known.reset) known.remaining = Math.min(known.remaining, remaining);
  }

  /** Whether the answer is GitHub asking to slow down; if so, the wait is recorded. */
  async function limited(response: Response): Promise<boolean> {
    if (response.status !== 403 && response.status !== 429) return false;
    const seconds = response.headers.get('retry-after');
    if (seconds !== null && Number.isFinite(Number(seconds))) {
      pausedUntil = Math.max(pausedUntil, now() + Number(seconds) * 1000);
      return true;
    }
    if (response.headers.get('x-ratelimit-remaining') === '0') return true; // the budget waits for the reset
    const text = await response.clone().text().catch(() => '');
    if (response.status === 429 || /secondary rate limit/i.test(text)) {
      pausedUntil = Math.max(pausedUntil, now() + SECONDARY_WAIT);
      return true;
    }
    return false; // forbidden for another reason
  }

  /** When the resource may be asked again. */
  function until(resource: string | undefined): number {
    const budget = resource ? budgets.get(resource) : undefined;
    return Math.max(pausedUntil, budget && budget.remaining <= 0 ? budget.reset + MARGIN : 0);
  }

  return {
    wrap: (fetch) => async (url, init) => {
      const resource = resourceOf(url);
      for (let attempt = 0; ; attempt++) {
        await spend(resource);
        await acquire();
        let response: Response;
        try {
          response = await fetch(url, init);
        } finally {
          release();
        }
        record(resource, response.headers);
        // Retried only if the wait is short enough; otherwise GitHub's own answer explains it.
        if (attempt >= 2 || !(await limited(response)) || until(resource) - now() > maxWait) return response;
        await response.body?.cancel();
      }
    },
  };
}

/** The rate-limit resource a GitHub URL counts against; raw files count against none. */
function resourceOf(url: string): string | undefined {
  const { host, pathname } = new URL(url);
  if (host !== 'api.github.com') return undefined;
  if (pathname.startsWith('/search/code')) return 'code_search';
  if (pathname.startsWith('/search/')) return 'search';
  return 'core';
}
