/**
 * The request checks every server runs first (src/server/checks.ts), on a test server: a `Host`
 * other than 127.0.0.1 or localhost, or none, is refused before anything is done (APP-API-011);
 * a change another site asks for is refused (APP-API-012). `fetch` overrides `Host` and cannot
 * leave it out, so these requests go through raw-http.ts. The test servers listen on 127.0.0.1
 * only (APP-SRV-005).
 */
import net from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../src/server/db.ts";
import { rawRequest, rawSocketRequest, type RawAnswer } from "../support/raw-http.ts";
import { startTestServer, type TestServer } from "../support/test-server.ts";

// A tripwire: nothing in this file may connect to the sim.
vi.mock("../../src/server/simconnect.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/server/simconnect.ts")>()),
  startSimLink: vi.fn(),
}));

const HOST_REFUSED = { error: "refused: this server answers only 127.0.0.1 and localhost" };
const CHANGE_REFUSED = { error: "refused: a change asked for by another site" };

const aircraftCount = () => (db.prepare("SELECT COUNT(*) AS n FROM aircraft").get() as { n: number }).n;
const aircraftName = (id: number) => (db.prepare("SELECT name FROM aircraft WHERE id = ?").get(id) as { name: string }).name;

let server: TestServer;
let port: string;

beforeAll(async () => {
  server = await startTestServer();
  port = new URL(server.base).port;
});
afterAll(async () => {
  await server.close();
});

/** A POST that would add an aircraft, with these headers on top of the JSON content type. */
const addAircraft = (headers: Record<string, string>): Promise<RawAnswer> =>
  rawRequest(server.base, {
    method: "POST",
    path: "/api/aircraft",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ name: "Request Checks Test", livery: "N1RC" }),
  });

/** The harmless change: clearing the casual path. */
const clearPath = (headers: Record<string, string>): Promise<RawAnswer> =>
  rawRequest(server.base, { method: "DELETE", path: "/api/tracker/path", headers });

describe("the Host check", () => {
  // @spec APP-API-011
  it("refuses another host name with 403 on the API, the icons and the page", async () => {
    for (const path of ["/api/status", "/api/tracker", "/api/no-such-thing", "/images/aircraft-1.png", "/", "/some/page/route"]) {
      const res = await rawRequest(server.base, { path, headers: { host: "evil.example" } });
      expect(res.status, path).toBe(403);
      expect(res.json(), path).toEqual(HOST_REFUSED);
    }
    for (const host of [
      `evil.example:${port}`,
      `127.0.0.2:${port}`,
      `localhost.evil.example:${port}`,
      `127.0.0.1.nip.io:${port}`,
      `[::1]:${port}`,
      `0.0.0.0:${port}`,
    ]) {
      const res = await rawRequest(server.base, { path: "/api/status", headers: { host } });
      expect(res.status, host).toBe(403);
      expect(res.json(), host).toEqual(HOST_REFUSED);
    }
  });

  // @spec APP-API-011
  it("acts on nothing for another host name: a valid new aircraft is not added", async () => {
    const before = aircraftCount();
    for (const headers of <Record<string, string>[]>[
      { host: "evil.example" },
      { host: `evil.example:${port}`, "sec-fetch-site": "same-origin" },
      { host: `evil.example:${port}`, origin: `http://127.0.0.1:${port}` },
    ]) {
      const res = await addAircraft(headers);
      expect(res.status, JSON.stringify(headers)).toBe(403);
      expect(res.json()).toEqual(HOST_REFUSED);
    }
    expect(aircraftCount()).toBe(before);
  });

  // @spec APP-API-011, APP-API-012
  it("checks the host before the change", async () => {
    const res = await addAircraft({ host: "evil.example", "sec-fetch-site": "cross-site", origin: "http://evil.example" });
    expect(res.status).toBe(403);
    expect(res.json()).toEqual(HOST_REFUSED);
  });

  // @spec APP-API-011
  it("accepts 127.0.0.1 and localhost, with or without the port, in any case", async () => {
    for (const host of [`127.0.0.1:${port}`, "127.0.0.1", `localhost:${port}`, "localhost", "LOCALHOST", `LocalHost:${port}`]) {
      const res = await rawRequest(server.base, { path: "/api/status", headers: { host } });
      expect(res.status, host).toBe(200);
      expect(res.json().ok, host).toBe(true);
    }
  });

  // @spec APP-API-011
  it("refuses a request with no Host header, or an empty one", async () => {
    const http11 = await rawSocketRequest(server.base, "GET /api/status HTTP/1.1\r\nConnection: close\r\n\r\n");
    expect(http11.statusLine).toMatch(/^HTTP\/1\.1 403 /);
    expect(JSON.parse(http11.body)).toEqual(HOST_REFUSED);

    const http10 = await rawSocketRequest(server.base, "GET /api/status HTTP/1.0\r\nConnection: close\r\n\r\n");
    expect(http10.statusLine).toMatch(/^HTTP\/1\.[01] 403 /);
    expect(JSON.parse(http10.body)).toEqual(HOST_REFUSED);

    const empty = await rawSocketRequest(server.base, "GET /api/status HTTP/1.1\r\nHost: \r\nConnection: close\r\n\r\n");
    expect(empty.statusLine).toMatch(/^HTTP\/1\.1 403 /);
    expect(JSON.parse(empty.body)).toEqual(HOST_REFUSED);

    // A change sent without Host is not made.
    const before = aircraftCount();
    const body = JSON.stringify({ name: "No Host Test" });
    const post = await rawSocketRequest(
      server.base,
      `POST /api/aircraft HTTP/1.1\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`,
    );
    expect(post.statusLine).toMatch(/^HTTP\/1\.1 403 /);
    expect(JSON.parse(post.body)).toEqual(HOST_REFUSED);
    expect(aircraftCount()).toBe(before);
  });
});

describe("the change check", () => {
  // @spec APP-API-012
  it("refuses a change with Sec-Fetch-Site cross-site or same-site, and changes nothing", async () => {
    const before = aircraftCount();
    for (const headers of <Record<string, string>[]>[
      { "sec-fetch-site": "cross-site" },
      { "sec-fetch-site": "same-site" },
      // Sec-Fetch-Site decides when present, whatever the Origin.
      { "sec-fetch-site": "cross-site", origin: `http://127.0.0.1:${port}` },
      { "sec-fetch-site": "same-site", origin: `http://localhost:${port}` },
    ]) {
      const res = await addAircraft(headers);
      expect(res.status, JSON.stringify(headers)).toBe(403);
      expect(res.json(), JSON.stringify(headers)).toEqual(CHANGE_REFUSED);
    }
    expect(aircraftCount()).toBe(before);

    const del = await clearPath({ "sec-fetch-site": "cross-site" });
    expect(del.status).toBe(403);
    expect(del.json()).toEqual(CHANGE_REFUSED);
  });

  // @spec APP-API-012
  it("refuses a change from another site on any path and method, before the route is looked up", async () => {
    const created = await addAircraft({});
    expect(created.status).toBe(201);
    const id = (created.json() as { id: number }).id;

    const put = await rawRequest(server.base, {
      method: "PUT",
      path: `/api/aircraft/${id}`,
      headers: { "content-type": "application/json", origin: "http://evil.example" },
      body: JSON.stringify({ name: "Renamed by another site" }),
    });
    expect(put.status).toBe(403);
    expect(put.json()).toEqual(CHANGE_REFUSED);
    expect(aircraftName(id)).toBe("Request Checks Test");

    const before = aircraftCount();
    const del = await rawRequest(server.base, { method: "DELETE", path: `/api/aircraft/${id}`, headers: { "sec-fetch-site": "cross-site" } });
    expect(del.status).toBe(403);
    expect(del.json()).toEqual(CHANGE_REFUSED);
    expect(aircraftCount()).toBe(before);

    for (const [method, path] of [
      ["POST", "/api/no-such-thing"],
      ["PATCH", `/api/aircraft/${id}`],
      ["POST", "/images/aircraft-1.png"],
      ["POST", "/"],
    ] as const) {
      const res = await rawRequest(server.base, { method, path, headers: { "sec-fetch-site": "cross-site" } });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.json(), `${method} ${path}`).toEqual(CHANGE_REFUSED);
    }
  });

  // @spec APP-API-012
  it("accepts a change with Sec-Fetch-Site same-origin, whatever the Origin, or none", async () => {
    const sameOrigin = await clearPath({ "sec-fetch-site": "same-origin", origin: "http://127.0.0.1:5173" });
    expect(sameOrigin.status).toBe(200);
    const none = await clearPath({ "sec-fetch-site": "none" });
    expect(none.status).toBe(200);

    const before = aircraftCount();
    const added = await addAircraft({ "sec-fetch-site": "same-origin", origin: `http://127.0.0.1:${port}` });
    expect(added.status).toBe(201);
    expect(aircraftCount()).toBe(before + 1);
  });

  // @spec APP-API-012
  it("without Sec-Fetch-Site, refuses an Origin other than the server's own, null included", async () => {
    const before = aircraftCount();
    for (const origin of [
      "http://evil.example",
      "null",
      "http://127.0.0.1:5173",
      `https://127.0.0.1:${port}`,
      `http://127.0.0.2:${port}`,
      `http://evil.example:${port}`,
    ]) {
      const res = await addAircraft({ origin });
      expect(res.status, origin).toBe(403);
      expect(res.json(), origin).toEqual(CHANGE_REFUSED);

      const del = await clearPath({ origin });
      expect(del.status, origin).toBe(403);
      expect(del.json(), origin).toEqual(CHANGE_REFUSED);
    }
    expect(aircraftCount()).toBe(before);
  });

  // @spec APP-API-012
  it("without Sec-Fetch-Site, accepts the server's own origin on 127.0.0.1 or localhost", async () => {
    for (const origin of [`http://127.0.0.1:${port}`, `http://localhost:${port}`]) {
      const res = await clearPath({ origin });
      expect(res.status, origin).toBe(200);
    }
    const before = aircraftCount();
    const added = await addAircraft({ origin: `http://localhost:${port}` });
    expect(added.status).toBe(201);
    expect(aircraftCount()).toBe(before + 1);
  });

  // @spec APP-API-012
  it("accepts a change carrying neither header", async () => {
    const del = await clearPath({});
    expect(del.status).toBe(200);
    const before = aircraftCount();
    const added = await addAircraft({});
    expect(added.status).toBe(201);
    expect(aircraftCount()).toBe(before + 1);
  });

  // @spec APP-API-012
  it("never refuses GET, HEAD or OPTIONS for where they come from", async () => {
    const fromElsewhere = { "sec-fetch-site": "cross-site", origin: "http://evil.example" };
    const get = await rawRequest(server.base, { path: "/api/status", headers: fromElsewhere });
    expect(get.status).toBe(200);
    expect(get.json().ok).toBe(true);

    const head = await rawRequest(server.base, { method: "HEAD", path: "/api/status", headers: fromElsewhere });
    expect(head.status).toBe(200);

    const options = await rawRequest(server.base, { method: "OPTIONS", path: "/api/status", headers: fromElsewhere });
    expect(options.status).not.toBe(403);
    expect(options.body).not.toContain(CHANGE_REFUSED.error);

    const nullOrigin = await rawRequest(server.base, { path: "/api/aircraft", headers: { origin: "null" } });
    expect(nullOrigin.status).toBe(200);
  });
});

describe("where the test servers listen", () => {
  // @spec APP-SRV-005
  it("binds 127.0.0.1 only: localhost's IPv6 address is refused", async () => {
    expect(server.base).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    const code = await new Promise<string | undefined>((resolve) => {
      const socket = net.connect({ host: "::1", port: Number(port) });
      socket.once("connect", () => {
        socket.destroy();
        resolve("connected");
      });
      socket.once("error", (e: NodeJS.ErrnoException) => resolve(e.code));
    });
    expect(code).toBe("ECONNREFUSED");
  });
});
