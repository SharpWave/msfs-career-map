import { test as base, expect } from "@playwright/test";
import { E2E_API_PORT, E2E_PAGE_PORT } from "../support/ports.ts";

const TEST_HOSTS = new Set(["localhost", "127.0.0.1"]);
const TEST_PORTS = new Set([String(E2E_API_PORT), String(E2E_PAGE_PORT)]);
const isTestServer = (url: URL) => url.protocol === "data:" || (TEST_HOSTS.has(url.hostname) && TEST_PORTS.has(url.port));

/**
 * Every browser test: the page may reach only the two test servers, and the tracker starts with
 * no live or pending leg, whatever an earlier test left.
 */
export const test = base.extend<{ isolated: void }>({
  isolated: [
    async ({ context, request }, use) => {
      // @spec APP-RUN-018
      await context.route((url) => !isTestServer(url), (route) => route.abort("blockedbyclient"));
      await request.delete("/api/tracker/leg");
      await request.delete("/api/tracker/pending");
      await use();
    },
    { auto: true },
  ],
});

export { expect };
