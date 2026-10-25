/**
 * The start-up stand-in (src/server/standin.ts, APP-SRV-009): while the start-up work is under way
 * it answers `/api/status` (APP-API-004, APP-API-008), runs the request checks (APP-API-011,
 * APP-API-012) ahead of everything, serves uploaded icons from the data folder, and answers every
 * other `/api` request with 503, `Retry-After: 1` and the step it is on.
 */
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../src/server/db.ts";
import { setStartup } from "../../src/server/status.ts";
import { createStandIn } from "../../src/server/standin.ts";
import { allowOrigin } from "../support/fetch-guard.ts";
import { rawRequest } from "../support/raw-http.ts";

// A tripwire: nothing in this file may connect to the sim.
vi.mock("../../src/server/simconnect.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/server/simconnect.ts")>()),
  startSimLink: vi.fn(),
}));

const DATA_FOLDER = path.dirname(path.resolve(process.env.CAREER_DB!));
const IMAGES = path.join(DATA_FOLDER, "images");
const HOST_REFUSED = { error: "refused: this server answers only 127.0.0.1 and localhost" };
const CHANGE_REFUSED = { error: "refused: a change asked for by another site" };
// A 1×1 transparent PNG.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

const aircraftCount = () => (db.prepare("SELECT COUNT(*) AS n FROM aircraft").get() as { n: number }).n;

describe("the start-up stand-in", () => {
  let server: http.Server;
  let base: string;
  let disallow: () => void;

  beforeAll(async () => {
    setStartup("opening");
    server = http.createServer({ requireHostHeader: false }, createStandIn());
    server.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    disallow = allowOrigin(base);
  });
  afterAll(async () => {
    setStartup("done");
    disallow?.();
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  // @spec APP-SRV-009, APP-API-004, APP-API-008, APP-API-009
  it("answers /api/status with 200 and the step it is on", async () => {
    const res = await fetch(`${base}/api/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      app: "msfs-career-map",
      pid: process.pid,
      dataFolder: DATA_FOLDER,
      sim: "off",
      startup: "opening",
      ready: false,
    });
    expect(Object.keys(body)).toContain("logbookId");
  });

  // @spec APP-SRV-009
  it("answers every other /api request with 503, Retry-After: 1 and the step", async () => {
    const before = aircraftCount();
    const requests: [string, RequestInit][] = [
      ["/api/tracker", {}],
      ["/api/aircraft", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Stand-in Test" }) }],
      ["/api/unknown", {}],
      ["/api/tracker/path", { method: "DELETE" }],
      ["/api/state", {}],
    ];
    for (const [p, init] of requests) {
      const res = await fetch(`${base}${p}`, init);
      expect(res.status, p).toBe(503);
      expect(res.headers.get("retry-after"), p).toBe("1");
      expect(await res.json(), p).toEqual({ error: "MSFS Career Map is starting (opening)" });
    }
    expect(aircraftCount()).toBe(before);
  });

  // @spec APP-SRV-009, APP-API-004
  it("names the step the start-up work is on at each request", async () => {
    try {
      setStartup("upgrading");
      const res = await fetch(`${base}/api/tracker`);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "MSFS Career Map is starting (upgrading)" });
      expect((await (await fetch(`${base}/api/status`)).json()).startup).toBe("upgrading");
    } finally {
      setStartup("opening");
    }
    const res = await fetch(`${base}/api/unknown`);
    expect(await res.json()).toEqual({ error: "MSFS Career Map is starting (opening)" });
  });

  // @spec APP-SRV-009, APP-API-011, APP-API-012
  it("runs the request checks ahead of the 503", async () => {
    for (const p of ["/api/tracker", "/api/status", "/images/aircraft-1.png", "/"]) {
      const res = await rawRequest(base, { path: p, headers: { host: "evil.example" } });
      expect(res.status, p).toBe(403);
      expect(res.json(), p).toEqual(HOST_REFUSED);
    }

    const before = aircraftCount();
    const crossSite = await rawRequest(base, {
      method: "POST",
      path: "/api/aircraft",
      headers: { "content-type": "application/json", "sec-fetch-site": "cross-site" },
      body: JSON.stringify({ name: "Stand-in Test" }),
    });
    expect(crossSite.status).toBe(403);
    expect(crossSite.json()).toEqual(CHANGE_REFUSED);
    const foreignOrigin = await rawRequest(base, { method: "DELETE", path: "/api/tracker/path", headers: { origin: "http://evil.example" } });
    expect(foreignOrigin.status).toBe(403);
    expect(foreignOrigin.json()).toEqual(CHANGE_REFUSED);
    expect(aircraftCount()).toBe(before);
  });

  // @spec APP-SRV-009, APP-SRV-008
  it("serves an uploaded icon from the data folder's images, and 404 for one that is missing", async () => {
    const name = "aircraft-standin-test.png";
    fs.writeFileSync(path.join(IMAGES, name), PNG);
    try {
      const res = await fetch(`${base}/images/${name}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/^image\/png/);
      expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
    } finally {
      fs.rmSync(path.join(IMAGES, name), { force: true });
    }
    // 404, never the page in place of an icon.
    const missing = await fetch(`${base}/images/aircraft-no-such-icon.png`);
    expect(missing.status).toBe(404);
  });
});
