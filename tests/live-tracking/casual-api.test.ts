import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../src/server/db.ts";
import type { SimSample } from "../../src/server/simconnect.ts";
import { tracker } from "../../src/server/tracker.ts";
import { startTestServer, type TestServer } from "../support/test-server.ts";

// A tripwire: nothing in this file may connect to the sim.
const simLink = vi.hoisted(() => ({ startSimLink: vi.fn() }));
vi.mock("../../src/server/simconnect.ts", () => simLink);

const KPVD = { lat: 41.7246, lon: -71.4282 };
const PLANE = { title: "API Comanche", livery: "N3TC", atc_id: "N3TC" };

// One clock for the whole file: the shared tracker keeps its last sample between tests.
let t = Date.parse("2026-10-12T12:00:00Z");
let lat = KPVD.lat;

function feed(on_ground: boolean, gs_kts: number) {
  const s: SimSample = {
    t, lat, lon: KPVD.lon, alt_ft: on_ground ? 60 : 1500, on_ground, gs_kts, hdg_deg: 0, vs_fpm: 0, ias_kts: gs_kts, g: 1,
    fuel_lb: 300, weight_lb: 2400, ...PLANE,
  };
  tracker.feed(s);
  t += 1000;
  if (gs_kts >= 1) lat += gs_kts / 3600 / 60;
}
const ground = (n: number, gs = 0) => { for (let i = 0; i < n; i++) feed(true, gs); };
const air = (n: number) => { for (let i = 0; i < n; i++) feed(false, 100); };

/** A fleet aircraft, bound to the sim aircraft being flown. */
function boundAircraft(): number {
  const r = db.prepare(`INSERT INTO aircraft (name, livery) VALUES (?, ?)`).run("API Comanche", "N3TC");
  const id = Number(r.lastInsertRowid);
  tracker.bind(id);
  return id;
}

/** Reads the tracker's event stream one event at a time. */
async function openEvents(base: string) {
  const ac = new AbortController();
  const res = await fetch(`${base}/api/tracker/events`, { signal: ac.signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const queue: { event: string; data: unknown }[] = [];
  const next = async (): Promise<{ event: string; data: unknown }> => {
    while (queue.length === 0) {
      const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("no event within 2 s")), 2000));
      const r = await Promise.race([reader.read(), timeout]);
      if (r.done) throw new Error("event stream ended");
      buf += decoder.decode(r.value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const event = /^event: (.*)$/m.exec(block)?.[1];
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (event && data !== undefined) queue.push({ event, data: JSON.parse(data) });
      }
    }
    return queue.shift()!;
  };
  /** The next event of that name, skipping others. */
  const until = async (name: string) => {
    for (;;) {
      const e = await next();
      if (e.event === name) return e.data;
    }
  };
  return { next, until, close: () => ac.abort() };
}

describe("the casual mode API", () => {
  let server: TestServer;
  const put = (body: unknown) =>
    fetch(`${server.base}/api/tracker/casual`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  beforeAll(async () => {
    server = await startTestServer();
    tracker.setConnected(true, "Fake MSFS");
  });
  afterAll(async () => {
    await server.close();
  });
  beforeEach(() => {
    tracker.setCasual(false);
    tracker.discardLeg("test");
    tracker.discardPending();
    db.exec(`DELETE FROM hops; DELETE FROM aircraft;`);
    lat = KPVD.lat;
    ground(1);
  });

  // @spec LIVE-API-008
  it("switches casual mode on and off, refusing anything but true or false", async () => {
    let res = await put({ on: true });
    expect(res.status).toBe(200);
    expect((await res.json()).casual).toMatchObject({ points: 0 });
    res = await put({ on: false });
    expect(res.status).toBe(200);
    expect((await res.json()).casual).toBeNull();
    for (const body of [{}, { on: "yes" }, { on: 1 }, { on: null }]) {
      res = await put(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(typeof (await res.json()).error).toBe("string");
    }
  });

  // @spec LIVE-API-008, LIVE-CASUAL-006, APP-API-001
  it("refuses with 409 and the leg's details while a bound aircraft's leg is airborne, and drops it when told to", async () => {
    const id = boundAircraft();
    ground(3);
    air(10);
    const leg = tracker.status().leg!;
    expect(leg.origin).toBe("KPVD");

    let res = await put({ on: true });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toEqual({ error: expect.any(String), aircraft_id: id, name: "API Comanche · N3TC", origin: "KPVD", departed_at: leg.departed_at });
    expect(tracker.status().casual).toBeNull();
    expect(tracker.status().leg).not.toBeNull();

    res = await put({ on: true, drop_leg: true });
    expect(res.status).toBe(200);
    const st = await res.json();
    expect(st.casual).not.toBeNull();
    expect(st.leg).toBeNull();
  });

  // @spec LIVE-CASUAL-009
  it("answers a request for the state casual mode is already in with the status, unchanged", async () => {
    const first = await (await put({ on: true })).json();
    air(12);
    const points = tracker.status().casual!.points;
    const again = await put({ on: true });
    expect(again.status).toBe(200);
    expect((await again.json()).casual).toEqual({ since: first.casual.since, points });
  });

  // @spec LIVE-API-009, LIVE-CASUAL-010
  it("clears the casual path", async () => {
    await put({ on: true });
    air(12);
    expect(tracker.status().casual!.points).toBeGreaterThan(0);
    const res = await fetch(`${server.base}/api/tracker/path`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect((await res.json()).casual).toMatchObject({ points: 0 });
    expect(tracker.path()).toEqual([]);
  });

  // @spec LIVE-API-011
  it("sends the path on connect after the status and the leg track, then the whole path for a new segment and each next point", async () => {
    const events = await openEvents(server.base);
    try {
      expect((await events.next()).event).toBe("status");
      expect((await events.next()).event).toBe("track");
      expect(await events.next()).toEqual({ event: "path", data: [] });

      await put({ on: true });
      expect(await events.until("path")).toEqual([]);
      air(1);
      const first = (await events.until("path")) as number[][][];
      expect(first).toHaveLength(1);
      expect(first[0]).toHaveLength(1);
      air(5);
      const pt = (await events.until("path-point")) as number[];
      expect(pt).toHaveLength(8);
      expect(pt[3] - first[0][0][3]).toBeGreaterThanOrEqual(5);
    } finally {
      events.close();
    }
  });

  // @spec SB-CUR-004
  it("refuses to import a SimBrief plan while casual mode is on, before asking SimBrief", async () => {
    await put({ on: true });
    const res = await fetch(`${server.base}/api/tracker/briefing`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(res.status).toBe(409);
    expect(typeof (await res.json()).error).toBe("string");
    expect(tracker.status().briefing).toBeNull();
  });
});
