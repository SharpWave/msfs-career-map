/**
 * After the tracker's final checkpoint (LIVE-SAVE-005), nothing changes it: every pilot's action
 * that would change the tracker's state is turned down, first on Tracker instances (ShuttingDown),
 * then over HTTP (LIVE-API-016), where the eight guarded routes answer 503 ahead of their own
 * answers, after the request checks and a body that cannot be read, and every other tracker route
 * answers as usual.
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../src/server/db.ts";
import { ShuttingDown, Tracker, tracker } from "../../src/server/tracker.ts";
import { openEvents } from "../support/event-stream.ts";
import { answerFetch, takeRefused } from "../support/fetch-guard.ts";
import { rawRequest } from "../support/raw-http.ts";
import { startTestServer, type TestServer } from "../support/test-server.ts";
import { fleetAircraft, flyCircuit, pilot, takeOff } from "./pilot.ts";
import { addBriefing, hopCount, rawCheckpoint, resetLogbook } from "./state.ts";

const SHUTTING_DOWN = { error: "MSFS Career Map is shutting down" };
const FEED_OFF = { error: "the fake feed is off: start the server with --sim=fake to accept synthetic samples" };
const NOT_THIS_HOST = { error: "refused: this server answers only 127.0.0.1 and localhost" };
const OTHER_SITE = { error: "refused: a change asked for by another site" };

const briefingCount = () => (db.prepare(`SELECT COUNT(*) AS n FROM briefings`).get() as { n: number }).n;

/** Expect `call` to throw ShuttingDown with its exact message. */
function expectShuttingDown(call: () => unknown, what: string): void {
  expect(typeof ShuttingDown, "ShuttingDown is exported from tracker.ts").toBe("function");
  let thrown: unknown = "nothing thrown";
  try {
    call();
  } catch (e) {
    thrown = e;
  }
  expect(thrown, what).toBeInstanceOf(ShuttingDown);
  expect((thrown as Error).message, what).toBe("MSFS Career Map is shutting down");
}

describe("a Tracker after shutdown()", () => {
  beforeEach(() => {
    resetLogbook();
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A tracker with a leg waiting to be logged and an airborne leg in progress, then shut down. */
  function shutDownInFlight() {
    const tr = new Tracker();
    tr.setConnected(true, "Fake MSFS");
    const p = pilot(tr);
    // Unbound, so the circuit is kept as a pending leg.
    flyCircuit(p);
    takeOff(p);
    p.air(20);
    const st = tr.status();
    expect(st.phase).toBe("airborne");
    expect(st.pending).toHaveLength(1);
    tr.shutdown({ quitting: false });
    return { tr, pendingId: st.pending[0].id };
  }

  const actions: [string, (tr: Tracker, o: { pendingId: string; aircraft: number }) => unknown][] = [
    ["bind, to a fleet aircraft that exists", (tr, o) => tr.bind(o.aircraft)],
    ["bind, to an unknown aircraft", (tr) => tr.bind(999_999)],
    ["bind, with a bad id", (tr) => tr.bind(Number.NaN)],
    ["setBriefing, attaching a plan", (tr) => tr.setBriefing(addBriefing())],
    ["setBriefing, removing the plan", (tr) => tr.setBriefing(null)],
    ["setCasual, on", (tr) => tr.setCasual(true)],
    ["setCasual, on, dropping the leg", (tr) => tr.setCasual(true, { dropLeg: true })],
    ["setCasual, off while it is off", (tr) => tr.setCasual(false)],
    ["discardLeg", (tr) => tr.discardLeg("discarded from the app")],
    ["completeNow, with no landed leg", (tr) => tr.completeNow()],
    ["savePending, a leg that is waiting", (tr, o) => tr.savePending(o.pendingId, { aircraft_id: o.aircraft, origin: "KPVD", dest: "KPVD" })],
    ["savePending, an unknown id", (tr) => tr.savePending(randomUUID(), {})],
    ["discardPending, a leg that is waiting", (tr, o) => tr.discardPending(o.pendingId)],
    ["discardPending, an unknown id", (tr) => tr.discardPending(randomUUID())],
  ];

  // @spec LIVE-SAVE-005
  it.each(actions)("turns down %s with ShuttingDown, changing nothing in memory or in the checkpoint", (what, act) => {
    const { tr, pendingId } = shutDownInFlight();
    const aircraft = fleetAircraft();
    const raw = rawCheckpoint();
    expect(raw).not.toBeNull();
    const st = tr.status();

    expectShuttingDown(() => act(tr, { pendingId, aircraft }), what);
    expect(rawCheckpoint()).toBe(raw);
    expect(tr.status()).toEqual(st);
    expect(hopCount()).toBe(0);
  });

  // @spec LIVE-SAVE-005
  it("still clears the casual path, which is never checkpointed", () => {
    const tr = new Tracker();
    tr.setConnected(true, "Fake MSFS");
    const p = pilot(tr);
    tr.setCasual(true);
    const since = tr.status().casual!.since;
    p.ground(3);
    p.air(20);
    expect(tr.path().length).toBeGreaterThan(0);
    tr.shutdown({ quitting: false });
    expect(tr.isShutDown()).toBe(true);
    const raw = rawCheckpoint();
    const paths: unknown[] = [];
    tr.on("path", (x) => paths.push(x));

    expect(() => tr.clearPath()).not.toThrow();
    expect(tr.path()).toEqual([]);
    expect(tr.status().casual).toEqual({ since, points: 0 });
    expect(paths).toEqual([[]]);
    expect(rawCheckpoint()).toBe(raw);
  });

  // @spec LIVE-SAVE-005, LIVE-SAVE-004
  it("writes nothing on saveNow()", () => {
    const SENTINEL = "2000-01-01T00:00:00.000Z";
    const setSentinel = () => db.prepare(`UPDATE tracker_state SET updated_at = ? WHERE id = 1`).run(SENTINEL);
    const row = () => db.prepare(`SELECT json, updated_at FROM tracker_state WHERE id = 1`).get() as { json: string; updated_at: string };

    // Before its shutdown, saveNow writes.
    const live = new Tracker();
    live.setConnected(true, "Fake MSFS");
    pilot(live).ground(3);
    live.saveNow();
    setSentinel();
    live.saveNow();
    expect(row().updated_at).not.toBe(SENTINEL);

    resetLogbook();
    const { tr } = shutDownInFlight();
    setSentinel();
    const raw = rawCheckpoint();
    tr.saveNow();
    expect(row()).toEqual({ json: raw, updated_at: SENTINEL });
  });

  // @spec LIVE-SAVE-005
  it("says it is shut down once shutdown() has run, quitting or not", () => {
    const staying = new Tracker();
    expect(staying.isShutDown()).toBe(false);
    staying.shutdown({ quitting: false });
    expect(staying.isShutDown()).toBe(true);

    const quitting = new Tracker();
    expect(quitting.isShutDown()).toBe(false);
    quitting.shutdown({ quitting: true });
    expect(quitting.isShutDown()).toBe(true);
  });
});

/** A guarded route, with input that would get a different answer were the tracker not shut down. */
interface Guarded {
  route: string;
  method: "PUT" | "POST" | "DELETE";
  path: string;
  body?: unknown;
  /** The answer without the shutdown. */
  usual: number;
}

const UNKNOWN_ID = randomUUID();
const GUARDED: Guarded[] = [
  { route: "PUT /api/tracker/casual", method: "PUT", path: "/api/tracker/casual", body: { on: "x" }, usual: 400 },
  { route: "POST /api/tracker/bind", method: "POST", path: "/api/tracker/bind", body: { aircraft_id: 999_999 }, usual: 404 },
  // Casual mode is on.
  { route: "POST /api/tracker/briefing", method: "POST", path: "/api/tracker/briefing", usual: 409 },
  { route: "DELETE /api/tracker/briefing", method: "DELETE", path: "/api/tracker/briefing", usual: 200 },
  { route: "DELETE /api/tracker/leg", method: "DELETE", path: "/api/tracker/leg", usual: 200 },
  // There is no leg.
  { route: "POST /api/tracker/complete", method: "POST", path: "/api/tracker/complete", usual: 409 },
  { route: "POST /api/tracker/pending/:id", method: "POST", path: `/api/tracker/pending/${UNKNOWN_ID}`, usual: 404 },
  { route: "DELETE /api/tracker/pending/:id", method: "DELETE", path: `/api/tracker/pending/${UNKNOWN_ID}`, usual: 404 },
];

/** A minimal SimBrief answer that parses. */
const OFP = {
  fetch: { status: "Success" },
  params: { request_id: "shutting-down-test", units: "lbs" },
  origin: { icao_code: "KPVD" },
  destination: { icao_code: "KBOS" },
};

describe("the tracker routes once the tracker has written its final checkpoint", () => {
  let server: TestServer;
  /** The checkpoint right after the singleton's shutdown. */
  let final: string | null = null;
  /** The answer to a briefing import that was fetching from SimBrief when the shutdown came. */
  let inFlight: { status: number; body: unknown };
  /** The briefings archived before SimBrief answered that import. */
  let briefingsBefore = 0;

  const send = (g: { method: string; path: string; body?: unknown }) =>
    fetch(`${server.base}${g.path}`, {
      method: g.method,
      headers: g.body === undefined ? {} : { "content-type": "application/json" },
      body: g.body === undefined ? undefined : JSON.stringify(g.body),
    });

  beforeAll(async () => {
    server = await startTestServer();
    // A SimBrief pilot, so that a briefing import gets as far as asking SimBrief.
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('simbrief_username', 'shutdown-test-pilot')
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run();

    // An import past the guard before the shutdown, its SimBrief answer held until after it.
    const simbrief: { answer?: (r: Response) => void } = {};
    answerFetch(/simbrief\.com\/api\/xml\.fetcher\.php/, () => new Promise<Response>((r) => (simbrief.answer = r)));
    const importing = send({ method: "POST", path: "/api/tracker/briefing" });
    for (let i = 0; i < 500 && !simbrief.answer; i++) await new Promise((r) => setTimeout(r, 10));
    if (!simbrief.answer) throw new Error("the briefing import never asked SimBrief");

    tracker.setCasual(true);
    tracker.shutdown({ quitting: false });
    final = rawCheckpoint();
    briefingsBefore = briefingCount();

    simbrief.answer(Response.json(OFP));
    const res = await importing;
    inFlight = { status: res.status, body: await res.json() };
  });
  afterAll(async () => {
    await server?.close();
  });

  // @spec LIVE-API-016, LIVE-SAVE-005
  it("answers an action that was already past the guard, and reaches the tracker after the final checkpoint, with the same 503", () => {
    expect(final).not.toBeNull();
    expect(inFlight).toEqual({ status: 503, body: SHUTTING_DOWN });
    expect(tracker.status().briefing).toBeNull();
    expect(rawCheckpoint()).toBe(final);
    // Checked again after the fetch: the plan is not archived either, as it stays on SimBrief.
    expect(briefingCount()).toBe(briefingsBefore);
  });

  // @spec LIVE-API-016, LIVE-SAVE-005
  it.each(GUARDED)("$route answers 503 with the exact body instead of its usual $usual, changing nothing", async (g) => {
    expect(tracker.isShutDown()).toBe(true);
    const raw = rawCheckpoint();
    const st = tracker.status();
    const briefings = briefingCount();

    const res = await send(g);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual(SHUTTING_DOWN);
    expect(rawCheckpoint()).toBe(raw);
    expect(tracker.status()).toEqual(st);
    expect(briefingCount()).toBe(briefings);
    // The SimBrief fetch is behind the guard too: no outside request was attempted.
    expect(takeRefused()).toEqual([]);
  });

  // @spec LIVE-API-016
  it.each(GUARDED)("$route still gets the request checks' 403 and a body it cannot read's 400 ahead of the 503", async (g) => {
    expect(tracker.isShutDown()).toBe(true);
    const raw = rawCheckpoint();
    const body = g.body === undefined ? "{}" : JSON.stringify(g.body);

    const otherSite = await rawRequest(server.base, {
      method: g.method,
      path: g.path,
      headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" },
      body,
    });
    expect(otherSite.status).toBe(403);
    expect(otherSite.json()).toEqual(OTHER_SITE);

    const otherHost = await rawRequest(server.base, {
      method: g.method,
      path: g.path,
      headers: { Host: "evil.example", "Content-Type": "application/json" },
      body,
    });
    expect(otherHost.status).toBe(403);
    expect(otherHost.json()).toEqual(NOT_THIS_HOST);

    const unreadable = await fetch(`${server.base}${g.path}`, {
      method: g.method,
      headers: { "content-type": "application/json" },
      body: '{"on":',
    });
    expect(unreadable.status).toBe(400);
    expect(await unreadable.text()).not.toContain(SHUTTING_DOWN.error);

    expect(rawCheckpoint()).toBe(raw);
  });

  // @spec LIVE-API-016
  it("still answers a body too large to read with 413 ahead of the 503", async () => {
    expect(tracker.isShutDown()).toBe(true);
    const raw = rawCheckpoint();
    const huge = JSON.stringify({ on: true, pad: "x".repeat(9 * 1024 * 1024) });
    for (const g of [GUARDED[0], GUARDED[1]]) {
      const res = await fetch(`${server.base}${g.path}`, { method: g.method, headers: { "content-type": "application/json" }, body: huge });
      expect(res.status, g.route).toBe(413);
      expect(await res.text(), g.route).not.toContain(SHUTTING_DOWN.error);
    }
    expect(rawCheckpoint()).toBe(raw);
  });

  // @spec LIVE-API-016
  it("answers GET /api/tracker as usual, casual mode still on", async () => {
    expect(tracker.isShutDown()).toBe(true);
    const raw = rawCheckpoint();
    const res = await fetch(`${server.base}/api/tracker`);
    expect(res.status).toBe(200);
    const st = await res.json();
    expect(st.casual).not.toBeNull();
    expect(st).toEqual(JSON.parse(JSON.stringify(tracker.status())));
    expect(rawCheckpoint()).toBe(raw);
  });

  // @spec LIVE-API-016
  it("answers GET /api/tracker/events as usual", async () => {
    expect(tracker.isShutDown()).toBe(true);
    const events = await openEvents(server.base);
    try {
      const st = (await events.until("status")) as { casual: unknown };
      expect(st.casual).not.toBeNull();
    } finally {
      events.close();
    }
  });

  // @spec LIVE-API-016
  it("answers a GET of an unknown pending leg with its usual 404", async () => {
    expect(tracker.isShutDown()).toBe(true);
    const res = await fetch(`${server.base}/api/tracker/pending/${UNKNOWN_ID}`);
    expect(res.status).toBe(404);
    expect((await res.json()).error).not.toBe(SHUTTING_DOWN.error);
  });

  // @spec LIVE-API-016
  it("clears the casual path on DELETE /api/tracker/path with 200 and the status, writing nothing", async () => {
    expect(tracker.isShutDown()).toBe(true);
    const raw = rawCheckpoint();
    const res = await fetch(`${server.base}/api/tracker/path`, { method: "DELETE" });
    expect(res.status).toBe(200);
    const st = await res.json();
    expect(st.casual).toMatchObject({ points: 0 });
    expect(tracker.path()).toEqual([]);
    expect(rawCheckpoint()).toBe(raw);
  });

  // @spec LIVE-API-016
  it("answers POST /api/tracker/sample with its usual 403, the test server's sim being off", async () => {
    expect(tracker.isShutDown()).toBe(true);
    const raw = rawCheckpoint();
    const res = await send({
      method: "POST",
      path: "/api/tracker/sample",
      body: { t: Date.now(), lat: 41.7246, lon: -71.4282, alt_ft: 55, on_ground: true, gs_kts: 0, hdg_deg: 0, title: "Test Comanche", livery: "N1TC", atc_id: "N1TC" },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(FEED_OFF);
    expect(rawCheckpoint()).toBe(raw);
  });

  // setSimMode is none of the calls §11 turns down or makes do nothing after shutdown(), so the
  // test server can be put on the fake feed here.
  // @spec LIVE-API-016, LIVE-SAVE-005
  it("answers POST /api/tracker/sample with 200 on the fake feed, and the tracker ignores the sample", async () => {
    expect(tracker.isShutDown()).toBe(true);
    tracker.setSimMode("fake");
    try {
      const raw = rawCheckpoint();
      const before = tracker.status();
      expect(before.sim_mode).toBe("fake");
      const res = await send({
        method: "POST",
        path: "/api/tracker/sample",
        // In the air 30 nm north of KPVD: a sample the tracker took would move its position and phase.
        body: { t: Date.now(), lat: 42.2246, lon: -71.4282, alt_ft: 3500, on_ground: false, gs_kts: 120, hdg_deg: 0, title: "Test Comanche", livery: "N1TC", atc_id: "N1TC" },
      });
      expect(res.status).toBe(200);
      expect(tracker.status()).toEqual(before);
      expect(rawCheckpoint()).toBe(raw);
    } finally {
      tracker.setSimMode("off");
    }
  });
});
