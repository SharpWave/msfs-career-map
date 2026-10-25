import http from "node:http";
import type { AddressInfo } from "node:net";
import { allowOrigin } from "./fetch-guard.ts";

export interface TestServer {
  /** e.g. "http://127.0.0.1:52011" */
  base: string;
  close(): Promise<void>;
}

/**
 * The app as the server builds it, on a free local port that the fetch guard lets through. Like a
 * server started as a process, it listens on 127.0.0.1 only, and with `requireHostHeader: false`,
 * so an HTTP/1.1 request without a `Host` header reaches the app's request checks instead of
 * getting Node's own 400.
 */
// @spec APP-SRV-005, APP-SRV-023
export async function startTestServer(): Promise<TestServer> {
  const { createApp } = await import("../../src/server/app.ts");
  const server = http.createServer({ requireHostHeader: false }, createApp());
  server.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const disallow = allowOrigin(base);
  return {
    base,
    close: () =>
      new Promise<void>((resolve, reject) => {
        disallow();
        // Open streams (the live event stream) would otherwise keep the server from closing.
        server.closeAllConnections();
        server.close((e) => (e ? reject(e) : resolve()));
      }),
  };
}
