/**
 * Keeps tests off the internet: replaces `fetch` so a request goes through only to an origin the
 * test allowed (its own server) or is answered by the test; anything else is refused and recorded.
 * Free of test-runner imports, so the browser-test server can use it too.
 */

type Reply = (url: URL, init?: RequestInit) => Response | Promise<Response>;

const realFetch = globalThis.fetch;
const allowed = new Set<string>();
let answers: { match: string | RegExp; reply: Reply }[] = [];
let refused: string[] = [];
let onRefused: ((url: string) => void) | undefined;

function matches(match: string | RegExp, url: URL): boolean {
  if (match instanceof RegExp) return match.test(url.href);
  return url.href === match || url.pathname + url.search === match || url.pathname === match;
}

/** Install the guard. Relative URLs (the page's "/api/..." calls in jsdom) resolve against the page. */
// @spec APP-RUN-014, APP-RUN-018
export function installFetchGuard(opts: { onRefused?: (url: string) => void } = {}): void {
  onRefused = opts.onRefused;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const raw = input instanceof Request ? input.url : String(input);
    const base = (globalThis as { location?: { href: string } }).location?.href ?? "http://localhost/";
    const url = new URL(raw, base);
    if (allowed.has(url.origin)) return realFetch(input, init);
    const answer = answers.find((a) => matches(a.match, url));
    if (answer) return answer.reply(url, init);
    refused.push(url.href);
    onRefused?.(url.href);
    throw new TypeError(`outside request refused in tests: ${url.href}`);
  };
}

/** Let requests to `origin` (e.g. "http://127.0.0.1:52011") through; returns a function undoing it. */
export function allowOrigin(origin: string): () => void {
  const o = new URL(origin).origin;
  allowed.add(o);
  return () => allowed.delete(o);
}

/** Answer requests whose URL matches — a full URL, a path ("/api/state") or a pattern. */
export function answerFetch(match: string | RegExp, reply: Reply): void {
  answers.push({ match, reply });
}

/** Forget every supplied answer. */
export function resetAnswers(): void {
  answers = [];
}

/** The requests refused since the last call, which this clears. */
export function takeRefused(): string[] {
  const out = refused;
  refused = [];
  return out;
}
