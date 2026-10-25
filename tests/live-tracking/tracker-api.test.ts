/**
 * The tracker's HTTP API on a test server, driving the server's own tracker: the status
 * (LIVE-API-001, LIVE-API-013), pending legs addressed by id (LIVE-API-003, LIVE-API-007), the
 * event stream's `hop` and `pending` events (LIVE-API-014), and the tracker's refusals told apart
 * from a write that failed (APP-API-001).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../src/server/db.ts";
import { Tracker, tracker, type HopEvent, type PendingLegStatus } from "../../src/server/tracker.ts";
import { openEvents } from "../support/event-stream.ts";
import { startTestServer, type TestServer } from "../support/test-server.ts";
import { OTHER, PLANE, fleetAircraft, flyCircuit, pilot, takeOff, type Pilot } from "./pilot.ts";
import { addBriefing, discardAllPending, hopRows, resetLogbook } from "./state.ts";

// A tripwire: nothing in this file may connect to the sim.
vi.mock("../../src/server/simconnect.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/server/simconnect.ts")>()),
  startSimLink: vi.fn(),
}));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** SQL that makes one kind of write to a table fail, as a full disk would. */
const failWrites = (name: string, when: "INSERT" | "UPDATE", table: string) =>
  `CREATE TEMP TRIGGER ${name} BEFORE ${when} ON ${table} BEGIN SELECT RAISE(ABORT, 'disk full'); END;`;
const HOP_FAILS = { fail_hop: failWrites("fail_hop", "INSERT", "hops") };
const CHECKPOINT_FAILS = {
  fail_upd: failWrites("fail_upd", "UPDATE", "tracker_state"),
  fail_ins: failWrites("fail_ins", "INSERT", "tracker_state"),
};

describe("the tracker API", () => {
  let server: TestServer;
  /** Flies PLANE, which a test binds to a fleet aircraft when it wants hops logged. */
  let plane: Pilot;
  /** Flies OTHER, which no fleet aircraft is bound to: its closed legs are kept as pending. */
  let other: Pilot;

  /**
   * That pilot, its clock first brought up to the other's: the server's tracker keeps its last
   * sample between tests, so its samples must only move forward.
   */
  const flying = (p: Pilot): Pilot => {
    const latest = Math.max(plane.t, other.t);
    if (p.t < latest) p.wait((latest - p.t) / 1000);
    return p;
  };

  const send = (method: "POST" | "DELETE", path: string, body?: unknown) =>
    fetch(`${server.base}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  /**
   * The answer to a request sent while the given writes fail, and how many times the server wrote
   * an error out meanwhile; the triggers are dropped afterwards whatever happens.
   */
  const whileFailing = async (triggers: Record<string, string>, request: () => Promise<Response>) => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const sql of Object.values(triggers)) db.exec(sql);
    try {
      const res = await request();
      return { status: res.status, body: await res.json(), logged: errors.mock.calls.length };
    } finally {
      for (const name of Object.keys(triggers)) db.exec(`DROP TRIGGER IF EXISTS ${name}`);
      errors.mockRestore();
    }
  };

  beforeAll(async () => {
    server = await startTestServer();
    vi.useFakeTimers({ toFake: ["Date"] });
    plane = pilot(tracker, PLANE);
    other = pilot(tracker, OTHER);
    tracker.setConnected(true, "Fake MSFS");
  });
  afterAll(async () => {
    await server.close();
    vi.useRealTimers();
  });
  beforeEach(() => {
    tracker.setCasual(false);
    tracker.discardLeg("test");
    discardAllPending(tracker);
    if (tracker.status().briefing) tracker.setBriefing(null);
    resetLogbook();
    plane.home();
    other.home();
    flying(plane).ground(1);
  });

  // @spec LIVE-API-001
  it("returns the status, with the leg in progress and its landings, and the pending legs in the order kept, each with its id and without its track", async () => {
    flyCircuit(flying(other));
    flyCircuit(other);
    // A third flight, touched down but still rolling.
    takeOff(other);
    other.air(30);
    other.home();
    other.ground(2, 30);

    const res = await fetch(`${server.base}/api/tracker`);
    expect(res.status).toBe(200);
    const st = await res.json();
    expect(Object.keys(st)).toEqual(
      expect.arrayContaining([
        "connected", "sim_name", "sim_running", "paused", "livery_supported", "sim", "aircraft_id",
        "phase", "position", "leg", "pending", "briefing", "message", "message_at",
      ]),
    );
    expect(st).toMatchObject({ connected: true, sim_name: "Fake MSFS", sim: OTHER, aircraft_id: null, phase: "landed" });
    expect(st.position).not.toBeNull();
    expect(st.leg.landings).toHaveLength(1);

    expect(st.pending).toHaveLength(2);
    for (const p of st.pending) {
      expect(p).toMatchObject({ id: expect.stringMatching(UUID), sim: OTHER, reason: expect.any(String), points: expect.any(Number) });
      expect(p.points).toBeGreaterThan(0);
      expect(p).not.toHaveProperty("track");
    }
    expect(st.pending[0].id).not.toBe(st.pending[1].id);
    expect(Date.parse(st.pending[0].departed_at)).toBeLessThan(Date.parse(st.pending[1].departed_at));
  });

  // @spec LIVE-API-003
  it("logs and discards each pending leg by its own id, and answers 404 for an unknown id", async () => {
    const aircraftId = fleetAircraft();
    flyCircuit(flying(other));
    flyCircuit(other);
    const listed = tracker.status().pending;
    expect(listed).toHaveLength(2);
    const [first, second] = listed;
    const details = { aircraft_id: aircraftId, origin: "KPVD", dest: "KPVD" };

    let res = await send("POST", `/api/tracker/pending/${second.id}`, details);
    expect(res.status).toBe(201);
    const hop = await res.json();
    expect(hop).toMatchObject({ id: hopRows().at(-1)!.id, aircraft_id: aircraftId, origin: "KPVD", dest: "KPVD", departed_at: second.departed_at });
    expect(tracker.status().pending.map((p) => p.id)).toEqual([first.id]);

    const unknown = randomUUID();
    expect((await send("POST", `/api/tracker/pending/${unknown}`, details)).status).toBe(404);
    expect((await send("DELETE", `/api/tracker/pending/${unknown}`)).status).toBe(404);

    res = await send("DELETE", `/api/tracker/pending/${first.id}`);
    expect(res.status).toBe(200);
    expect((await res.json()).pending).toEqual([]);
  });

  // @spec LIVE-API-007
  it("returns a pending leg in full by its id, with its track, landings, statistics and briefing, and 404 for an unknown id", async () => {
    const briefing = addBriefing();
    tracker.setBriefing(briefing);
    flyCircuit(flying(other));
    const listed = tracker.status().pending;
    expect(listed).toHaveLength(1);
    const entry = listed[0];

    const res = await fetch(`${server.base}/api/tracker/pending/${entry.id}`);
    expect(res.status).toBe(200);
    const leg = await res.json();
    expect(leg.id).toBe(entry.id);
    expect(leg.track).toHaveLength(entry.points);
    for (const pt of leg.track) {
      expect(pt).toHaveLength(8);
      for (const v of pt) expect(v).toBeTypeOf("number");
    }
    expect(Array.isArray(leg.landings)).toBe(true);
    expect(leg.stats).toBeTypeOf("object");
    expect(leg.stats).not.toBeNull();
    expect(leg.briefing).toMatchObject({ id: briefing.id });

    expect((await fetch(`${server.base}/api/tracker/pending/${randomUUID()}`)).status).toBe(404);
  });

  // @spec LIVE-API-013
  it("reports sim mode off and no sim host or link holder on a server that does not link to the sim", async () => {
    const res = await fetch(`${server.base}/api/tracker`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sim_mode: "off", sim_host: null, link_holder: null });
  });

  // @spec LIVE-API-013
  it("reports the sim mode, the sim's host and the holder of the sim-link claim it is given", () => {
    const t = new Tracker();

    t.setSimMode("fake");
    expect(t.status()).toMatchObject({ sim_mode: "fake", sim_host: null });
    t.setSimMode("link", "192.168.1.20");
    expect(t.status()).toMatchObject({ sim_mode: "link", sim_host: "192.168.1.20" });
    t.setSimMode("link");
    expect(t.status()).toMatchObject({ sim_mode: "link", sim_host: null });

    const installed = "C:\\Users\\pilot\\AppData\\Roaming\\MSFS Career Map";
    t.setLinkHolder({ holder: "installed", data_folder: installed });
    expect(t.status().link_holder).toEqual({
      holder: "installed",
      data_folder: installed,
      text: "The sim is linked to another copy (the installed app)",
    });
    const source = "C:\\Users\\pilot\\dev\\msfs-career-map\\data";
    t.setLinkHolder({ holder: "source", data_folder: source });
    expect(t.status().link_holder).toEqual({
      holder: "source",
      data_folder: source,
      text: "The sim is linked to another copy (run from source)",
    });
    t.setLinkHolder({ holder: null, data_folder: null });
    expect(t.status().link_holder).toEqual({ holder: null, data_folder: null, text: "The sim is linked to another copy" });
    t.setLinkHolder(null);
    expect(t.status().link_holder).toBeNull();
  });

  // @spec LIVE-API-014
  it("sends each hop logged from a closed leg as {hop, message}", async () => {
    const aircraftId = fleetAircraft();
    tracker.bind(aircraftId);
    const events = await openEvents(server.base);
    try {
      flyCircuit(flying(plane));
      const ev = (await events.until("hop")) as HopEvent;
      expect(ev).toEqual({ hop: expect.objectContaining({ origin: "KPVD", dest: "KPVD" }), message: expect.any(String) });
      expect(ev.hop.id).toBe(hopRows().at(-1)!.id);
      expect(ev.message).toBe(tracker.status().message);
      expect(ev.message.startsWith("Logged KPVD → KPVD")).toBe(true);
    } finally {
      events.close();
    }
  });

  // @spec LIVE-API-014
  it("sends each leg kept as pending as the status lists it, and the hop logged from it as {hop, message}", async () => {
    const aircraftId = fleetAircraft();
    const events = await openEvents(server.base);
    try {
      flyCircuit(flying(other));
      const leg = (await events.until("pending")) as PendingLegStatus;
      expect(leg).toMatchObject({ id: expect.stringMatching(UUID), sim: OTHER, reason: expect.any(String), points: expect.any(Number) });
      expect(leg).not.toHaveProperty("track");
      expect(tracker.status().pending).toEqual([leg]);

      const res = await send("POST", `/api/tracker/pending/${leg.id}`, { aircraft_id: aircraftId, origin: "KPVD", dest: "KPVD" });
      expect(res.status).toBe(201);
      const ev = (await events.until("hop")) as HopEvent;
      expect(ev).toEqual({ hop: expect.objectContaining({ origin: "KPVD", dest: "KPVD" }), message: expect.any(String) });
      expect(ev.hop.id).toBe(hopRows().at(-1)!.id);
      expect(ev.message).toBe(tracker.status().message);
      expect(ev.message.startsWith("Logged KPVD → KPVD")).toBe(true);
    } finally {
      events.close();
    }
  });

  // @spec APP-API-001, LIVE-HOP-004, LIVE-SAVE-006
  it("refuses with 400 to log a pending leg still missing its aircraft, and answers a failed write with 500, writing it out and keeping the leg", async () => {
    const aircraftId = fleetAircraft();
    flyCircuit(flying(other));
    const [leg] = tracker.status().pending;
    expect(leg.aircraft_id).toBeNull();

    let res = await send("POST", `/api/tracker/pending/${leg.id}`, { origin: "KPVD", dest: "KPVD" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: expect.any(String) });

    const failed = await whileFailing(HOP_FAILS, () => send("POST", `/api/tracker/pending/${leg.id}`, { aircraft_id: aircraftId }));
    expect(failed).toEqual({ status: 500, body: { error: "disk full" }, logged: 1 });
    expect(hopRows()).toEqual([]);
    expect(tracker.status().pending.map((p) => p.id)).toEqual([leg.id]);

    res = await send("POST", `/api/tracker/pending/${leg.id}`, { aircraft_id: aircraftId });
    expect(res.status).toBe(201);
    expect(hopRows()).toHaveLength(1);
  });

  // @spec APP-API-001, LIVE-LEG-007, LIVE-SAVE-006
  it("refuses Log now with 409 while no leg is landed, and answers a failed write with 500, writing it out and keeping the landed leg", async () => {
    tracker.bind(fleetAircraft());
    let res = await send("POST", "/api/tracker/complete");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: expect.any(String) });

    const p = flying(plane);
    takeOff(p);
    p.air(80);
    p.home();
    p.ground(5, 30);
    expect(tracker.status().phase).toBe("landed");

    const failed = await whileFailing(HOP_FAILS, () => send("POST", "/api/tracker/complete"));
    expect(failed).toEqual({ status: 500, body: { error: "disk full" }, logged: 1 });
    expect(hopRows()).toEqual([]);
    expect(tracker.status()).toMatchObject({ phase: "landed", leg: { origin: "KPVD" } });

    res = await send("POST", "/api/tracker/complete");
    expect(res.status).toBe(200);
    expect(hopRows()).toHaveLength(1);
  });

  // @spec APP-API-001, LIVE-BIND-002
  it("refuses to bind an unknown aircraft with 404, and answers a failed write with 500, writing it out", async () => {
    const aircraftId = fleetAircraft();
    let res = await send("POST", "/api/tracker/bind", { aircraft_id: aircraftId + 1000 });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: expect.any(String) });

    const failed = await whileFailing(CHECKPOINT_FAILS, () => send("POST", "/api/tracker/bind", { aircraft_id: aircraftId }));
    expect(failed).toEqual({ status: 500, body: { error: "disk full" }, logged: 1 });

    res = await send("POST", "/api/tracker/bind", { aircraft_id: aircraftId });
    expect(res.status).toBe(200);
    expect((await res.json()).aircraft_id).toBe(aircraftId);
  });
});
