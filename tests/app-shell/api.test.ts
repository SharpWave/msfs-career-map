import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fixtureCounts } from "../support/run-folder.ts";
import { startTestServer, type TestServer } from "../support/test-server.ts";

// A tripwire: nothing in this file may connect to the sim.
const simLink = vi.hoisted(() => ({ startSimLink: vi.fn() }));
vi.mock("../../src/server/simconnect.ts", () => simLink);

// A 1×1 transparent PNG.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("building the app", () => {
  // @spec APP-SRV-004
  it("builds the app without listening, connecting to the sim or loading airport data", async () => {
    const listen = vi.spyOn(net.Server.prototype, "listen");
    const reads = vi.spyOn(fs, "readFileSync");
    try {
      const { createApp } = await import("../../src/server/app.ts");
      const app = createApp();
      expect(typeof app).toBe("function");
      expect(listen).not.toHaveBeenCalled();
      expect(simLink.startSimLink).not.toHaveBeenCalled();
      const csvReads = reads.mock.calls.filter(([p]) => /(airports|runways)\.csv$/.test(String(p)));
      expect(csvReads).toEqual([]);
    } finally {
      listen.mockRestore();
      reads.mockRestore();
    }
  });
});

describe("API conventions", () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startTestServer();
  });
  afterAll(async () => {
    await server.close();
  });

  // @spec APP-API-004
  it("reports ok, the airport and runway counts and the version at /api/status", async () => {
    const res = await fetch(`${server.base}/api/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, airports: fixtureCounts().airports, runways: fixtureCounts().runways });
    expect(typeof body.version).toBe("string");
  });

  // @spec APP-API-001
  it("answers a known failure with its status and the error message", async () => {
    const res = await fetch(`${server.base}/api/airports/ZZZZ9`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "airport not found: ZZZZ9" });
  });

  // @spec APP-API-002
  it("answers an unknown API path with 404 not found", async () => {
    const res = await fetch(`${server.base}/api/no-such-thing`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not found" });
  });

  // @spec APP-API-003
  it("answers an id that is not a positive whole number with 400 invalid id", async () => {
    for (const id of ["abc", "0", "-3", "1.5"]) {
      const res = await fetch(`${server.base}/api/briefings/${id}`);
      expect(res.status, id).toBe(400);
      expect(await res.json()).toEqual({ error: "invalid id" });
    }
  });

  // @spec APP-SRV-002
  it("accepts JSON bodies up to 8 MB and refuses larger ones", async () => {
    const post = (bytes: number) =>
      fetch(`${server.base}/api/aircraft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "", notes: "x".repeat(bytes) }),
      });
    expect((await post(7 * 1024 * 1024)).status).not.toBe(413);
    expect((await post(9 * 1024 * 1024)).status).toBe(413);
  });

  // @spec APP-SRV-002, APP-DATA-002
  it("stores an uploaded icon in this database's images folder and serves it under /images with a one-year cache", async () => {
    const { IMAGES_DIR, DB_PATH } = await import("../../src/server/db.ts");
    // Never upload into a folder that is not this test file's own.
    expect(IMAGES_DIR).toBe(path.join(path.dirname(DB_PATH), "images"));

    const created = await fetch(`${server.base}/api/aircraft`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Icon Test", livery: "N1CN" }),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: number };
    const up = await fetch(`${server.base}/api/aircraft/${id}/icon`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataUrl: `data:image/png;base64,${PNG}` }),
    });
    expect(up.status).toBe(200);
    const { icon } = (await up.json()) as { icon: string };
    expect(icon).toMatch(new RegExp(`^/images/aircraft-${id}\\.png\\?v=\\d+$`));
    expect(fs.existsSync(path.join(IMAGES_DIR, `aircraft-${id}.png`))).toBe(true);

    const img = await fetch(`${server.base}${icon}`);
    expect(img.status).toBe(200);
    expect(img.headers.get("cache-control")).toMatch(/max-age=31536000/);
    expect(img.headers.get("cache-control")).toMatch(/immutable/);
  });

  // @spec APP-RUN-011
  it("closes the test server even while a live event stream is open", async () => {
    const extra = await startTestServer();
    const controller = new AbortController();
    const stream = await fetch(`${extra.base}/api/tracker/events`, { signal: controller.signal });
    expect(stream.status).toBe(200);
    const started = Date.now();
    await extra.close();
    expect(Date.now() - started).toBeLessThan(5000);
    controller.abort();
  });
});
