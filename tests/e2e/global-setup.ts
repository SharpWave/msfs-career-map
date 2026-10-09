import { fixtureCounts } from "../support/run-folder.ts";
import { E2E_PAGE_PORT } from "../support/ports.ts";

/**
 * Runs after Playwright has started both servers and before the first test: the page server must
 * reach the browser-test app server, recognisable by the fixture lists' airport count.
 */
// @spec APP-RUN-017
export default async function checkTestServer(): Promise<void> {
  const url = `http://localhost:${E2E_PAGE_PORT}/api/status`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} answered ${res.status}; refusing to run the browser tests`);
  const status = (await res.json()) as { airports?: number };
  const expected = fixtureCounts().airports;
  if (status.airports !== expected) {
    throw new Error(
      `${url} reports ${status.airports} airports, not the fixture lists' ${expected}: ` +
        "the page is not talking to the browser-test server, so no test runs",
    );
  }
}
