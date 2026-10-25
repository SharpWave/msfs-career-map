import { fixtureCounts } from "../support/run-folder.ts";
import { E2E_PAGE_PORT } from "../support/ports.ts";

export interface WaitForTestServerOptions {
  /** How long to wait for `ready`, in ms. Default 60000. */
  timeoutMs?: number;
  /** The pause between two asks, in ms. Default 250. */
  intervalMs?: number;
  /** The airport count the server must report once ready. Default: the fixture lists' count. */
  airports?: number;
}

const reason = (e: unknown) => (e instanceof Error ? `${e.message}${e.cause instanceof Error ? ` (${e.cause.message})` : ""}` : String(e));

/**
 * Asks `statusUrl` until it reports `ready: true` (APP-API-009), for at most `timeoutMs`: an answer
 * that is not ready yet, not JSON, not 200, or no answer at all is asked again after `intervalMs`.
 * Once ready, the airport count must be `airports`. Rejects on a timeout or a mismatch, naming which.
 */
// @spec APP-RUN-017
export async function waitForTestServer(statusUrl: string, o: WaitForTestServerOptions = {}): Promise<void> {
  const timeoutMs = o.timeoutMs ?? 60_000;
  const intervalMs = o.intervalMs ?? 250;
  const expected = o.airports ?? fixtureCounts().airports;
  const deadline = Date.now() + timeoutMs;
  let last = "no answer yet";
  for (;;) {
    let ready: { airports?: unknown } | null = null;
    try {
      // A server that accepts and never answers must not hold the run past the deadline.
      const res = await fetch(statusUrl, { signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())) });
      const text = await res.text();
      if (res.status !== 200) {
        last = `${res.status} ${text.slice(0, 200)}`;
      } else {
        const status = JSON.parse(text) as { ready?: unknown; startup?: unknown; airports?: unknown };
        if (status.ready === true) ready = status;
        else last = `ready ${JSON.stringify(status.ready)}, startup ${JSON.stringify(status.startup)}`;
      }
    } catch (e) {
      last = reason(e);
    }
    if (ready) {
      if (ready.airports !== expected) {
        throw new Error(
          `airport count mismatch: ${statusUrl} reports ${JSON.stringify(ready.airports)} airports, not the fixture lists' ` +
            `${expected}: the page is not talking to the browser-test server, so no test runs`,
        );
      }
      return;
    }
    const left = deadline - Date.now();
    if (left <= 0) {
      throw new Error(`timed out: ${statusUrl} did not report ready within ${timeoutMs} ms (last: ${last}), so no test runs`);
    }
    await new Promise((r) => setTimeout(r, Math.min(intervalMs, left)));
  }
}

/**
 * Runs after Playwright has started both servers and before the first test: the page server must
 * reach the browser-test app server, ready and recognisable by the fixture lists' airport count.
 */
// @spec APP-RUN-017
export default async function checkTestServer(): Promise<void> {
  await waitForTestServer(`http://127.0.0.1:${E2E_PAGE_PORT}/api/status`);
}
