/**
 * The sim's clock: the link reading the sim's zulu date and time with each once-a-second sample
 * (LIVE-LINK-008), each leg recording its departure and arrival on it as well as on the real-world
 * clock (LIVE-REC-004), and the logbook storing both, the sim-clock times in nullable columns an
 * older version of the app can log a hop beside (LOG-REC-002).
 *
 * A sample carries the sim's clock as `sim_t`, epoch ms, or null when the link has not read it.
 */
import { open, SimConnectPeriod } from "node-simconnect";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../src/server/db.ts";
import { startSimLink, type SimSample } from "../../src/server/simconnect.ts";
import { Tracker } from "../../src/server/tracker.ts";
import { startTestServer, type TestServer } from "../support/test-server.ts";
import { FakeSimHandle, settle } from "./fake-sim.ts";
import { OTHER, fleetAircraft, flyCircuit, pilot, takeOff } from "./pilot.ts";
import { resetLogbook } from "./state.ts";

vi.mock("node-simconnect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node-simconnect")>()),
  open: vi.fn(),
}));

const iso = (ms: number) => new Date(ms).toISOString();

/** A hop's real-world and sim-clock times, as stored. */
const hopTimes = () =>
  db.prepare(`SELECT departed_at, arrived_at, sim_departed_at, sim_arrived_at FROM hops ORDER BY id`).all() as {
    departed_at: string | null;
    arrived_at: string | null;
    sim_departed_at: string | null;
    sim_arrived_at: string | null;
  }[];

describe("the link reading the sim's clock (LIVE-LINK-008)", () => {
  let link: { stop(): void } | null = null;
  let samples: SimSample[];

  beforeEach(() => {
    vi.mocked(open).mockReset();
    vi.mocked(open).mockImplementation(() => new Promise(() => {}) as never);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-24T12:00:00.000Z"));
    samples = [];
  });
  afterEach(() => {
    link?.stop();
    link = null;
    vi.useRealTimers();
  });

  async function connect(...fakes: FakeSimHandle[]) {
    for (const hd of fakes) vi.mocked(open).mockResolvedValueOnce({ recvOpen: { applicationName: "Fake MSFS" }, handle: hd } as never);
    const onConnect = vi.fn();
    link = startSimLink({ onSample: (s) => samples.push(s), onConnect, onDisconnect: vi.fn() }, { retryMs: 10 });
    await settle();
    expect(onConnect).toHaveBeenCalledTimes(1);
    fakes[0].livery("N1TP");
  }

  // @spec LIVE-LINK-008
  it("asks for the sim's zulu date and time once a second", async () => {
    const hd = new FakeSimHandle();
    await connect(hd);
    const names = hd.addToDataDefinition.mock.calls.map((c) => c[1]);
    expect(names).toEqual(expect.arrayContaining(["ZULU YEAR", "ZULU MONTH OF YEAR", "ZULU DAY OF MONTH", "ZULU TIME"]));
    const clockDef = hd.addToDataDefinition.mock.calls.find((c) => c[1] === "ZULU TIME")![0];
    const request = hd.requestDataOnSimObject.mock.calls.find((c) => c[1] === clockDef);
    expect(request).toBeDefined();
    expect(request![3]).toBe(SimConnectPeriod.SECOND);
  });

  // @spec LIVE-LINK-008
  it("puts the sim's clock on each sample, moved on by the time since it was read", async () => {
    const hd = new FakeSimHandle();
    await connect(hd);
    hd.clock("2026-03-01T08:15:30.000Z");
    vi.setSystemTime(Date.now() + 400);
    hd.position();
    vi.setSystemTime(Date.now() + 1000);
    hd.clock("2026-03-01T08:15:31.500Z");
    hd.position();
    expect(samples.map((s) => s.sim_t)).toEqual([Date.parse("2026-03-01T08:15:30.400Z"), Date.parse("2026-03-01T08:15:31.500Z")]);
  });

  // @spec LIVE-LINK-008
  it("reads the sim's clock across midnight and the end of a year", async () => {
    const hd = new FakeSimHandle();
    await connect(hd);
    hd.clock("2026-12-31T23:59:59.000Z");
    hd.position();
    hd.clock("2027-01-01T00:00:00.000Z");
    hd.position();
    expect(samples.map((s) => s.sim_t)).toEqual([Date.parse("2026-12-31T23:59:59.000Z"), Date.parse("2027-01-01T00:00:00.000Z")]);
  });

  // @spec LIVE-LINK-008
  it("gives a null sim clock before the first reading, and after a reading it cannot make into a date", async () => {
    const hd = new FakeSimHandle();
    await connect(hd);
    hd.position();
    hd.clock("2026-03-01T08:15:30.000Z", { "ZULU MONTH OF YEAR": Number.NaN });
    hd.position();
    hd.clock("2026-03-01T08:15:30.000Z", { "ZULU MONTH OF YEAR": 13 });
    hd.position();
    expect(samples.map((s) => s.sim_t)).toEqual([null, null, null]);
    expect(samples).toHaveLength(3);
  });

  // @spec LIVE-LINK-008
  it("tracks on with a null sim clock when the sim rejects a clock variable", async () => {
    const hd = new FakeSimHandle();
    await connect(hd);
    hd.rejectClock("ZULU YEAR");
    hd.position();
    hd.position();
    expect(samples.map((s) => s.sim_t)).toEqual([null, null]);
  });

  // @spec LIVE-LINK-008
  it("never carries a reading from an earlier connection onto a new one", async () => {
    const first = new FakeSimHandle();
    const second = new FakeSimHandle();
    await connect(first, second);
    first.clock("2026-03-01T08:15:30.000Z");
    first.position();
    first.lose();
    for (let i = 0; i < 100 && vi.mocked(open).mock.calls.length < 2; i++) await new Promise((r) => setTimeout(r, 5));
    await settle();
    second.livery("N1TP");
    second.position();
    expect(samples.map((s) => s.sim_t)).toEqual([Date.parse("2026-03-01T08:15:30.000Z"), null]);
  });
});

describe("a leg's times on the sim's clock (LIVE-REC-004)", () => {
  /** The sim's clock five hours and a quarter behind the PC's. */
  const OFFSET = -(5 * 3600 + 900) * 1000;
  let tr: Tracker;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    resetLogbook();
    tr = new Tracker();
    tr.setConnected(true, "Fake MSFS");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // @spec LIVE-REC-004, LOG-REC-002
  it("logs a hop with its takeoff and last touchdown on the sim's clock as well as the real-world clock", () => {
    fleetAircraft();
    const p = pilot(tr, undefined, { simClockOffsetMs: OFFSET });
    p.ground(3);
    const departed = p.t;
    p.air(10);
    p.air(110);
    p.home();
    const touchdown = p.t;
    p.ground(5, 30);
    p.ground(35);
    expect(hopTimes()).toEqual([
      { departed_at: iso(departed), arrived_at: iso(touchdown), sim_departed_at: iso(departed + OFFSET), sim_arrived_at: iso(touchdown + OFFSET) },
    ]);
  });

  // @spec LIVE-REC-004
  it("takes the sim-clock departure from the first airborne sample, as the real one", () => {
    fleetAircraft();
    const p = pilot(tr, undefined, { simClockOffsetMs: OFFSET });
    p.ground(3);
    const departed = p.t;
    // The sim's clock jumps (the user set the time of day) during the takeoff confirmation.
    p.feed({ on_ground: false, gs_kts: 100, alt_ft: 1500, ias_kts: 100 });
    p.feed({ on_ground: false, gs_kts: 100, alt_ft: 1500, ias_kts: 100, sim_t: p.t + OFFSET + 3_600_000 });
    p.air(10);
    p.air(110);
    p.home();
    p.ground(5, 30);
    p.ground(35);
    expect(hopTimes()[0].sim_departed_at).toBe(iso(departed + OFFSET));
  });

  // @spec LIVE-REC-004
  it("keeps both clocks' times on a pending leg, and logs them with it", () => {
    const p = pilot(tr, OTHER, { simClockOffsetMs: OFFSET });
    p.ground(3);
    const departed = p.t;
    p.air(10);
    p.air(110);
    p.home();
    const touchdown = p.t;
    p.ground(5, 30);
    p.ground(35);
    const [leg] = tr.status().pending;
    expect(leg).toMatchObject({ sim_departed_at: iso(departed + OFFSET), sim_arrived_at: iso(touchdown + OFFSET) });
    expect(tr.pendingLeg(leg.id)).toMatchObject({ sim_departed_at: iso(departed + OFFSET), sim_arrived_at: iso(touchdown + OFFSET) });

    tr.savePending(leg.id, { aircraft_id: fleetAircraft(OTHER, "Test Cub", "Yellow") });
    expect(hopTimes()).toEqual([
      { departed_at: iso(departed), arrived_at: iso(touchdown), sim_departed_at: iso(departed + OFFSET), sim_arrived_at: iso(touchdown + OFFSET) },
    ]);
  });

  // @spec LIVE-REC-004
  it("ends a leg kept in the air at the last sample's sim-clock time", () => {
    const p = pilot(tr, undefined, { simClockOffsetMs: OFFSET });
    takeOff(p);
    p.air(60);
    const last = p.t;
    p.air(1);
    tr.setConnected(false);
    const [leg] = tr.status().pending;
    expect(leg.reason).toBe("the sim disconnected in flight");
    expect(leg.sim_arrived_at).toBe(iso(last + OFFSET));
  });

  // @spec LIVE-REC-004, LIVE-SAVE-002
  it("keeps the sim-clock departure with a leg in progress across a server restart", () => {
    fleetAircraft();
    const p = pilot(tr, undefined, { simClockOffsetMs: OFFSET });
    p.ground(3);
    const departed = p.t;
    p.air(10);
    p.air(30);
    tr.saveNow();
    const after = new Tracker();
    after.setConnected(true, "Fake MSFS");
    p.use(after);
    p.air(80);
    p.home();
    p.ground(5, 30);
    p.ground(35);
    expect(hopTimes()[0].sim_departed_at).toBe(iso(departed + OFFSET));
  });

  // @spec LIVE-REC-004, LOG-REC-002
  it("leaves the sim-clock times empty when the samples carry no sim clock", () => {
    fleetAircraft();
    const p = pilot(tr);
    flyCircuit(p);
    expect(hopTimes()).toHaveLength(1);
    expect(hopTimes()[0]).toMatchObject({ sim_departed_at: null, sim_arrived_at: null });
    expect(hopTimes()[0].departed_at).not.toBeNull();
  });

  // @spec LIVE-REC-004
  it("restores a pending leg saved before the sim's clock was recorded, with empty sim-clock times", () => {
    const p = pilot(tr, OTHER, { simClockOffsetMs: OFFSET });
    flyCircuit(p);
    tr.saveNow();
    const cp = JSON.parse((db.prepare(`SELECT json FROM tracker_state WHERE id = 1`).get() as { json: string }).json);
    delete cp.pending[0].sim_departed_at;
    delete cp.pending[0].sim_arrived_at;
    db.prepare(`UPDATE tracker_state SET json = ? WHERE id = 1`).run(JSON.stringify(cp));

    const after = new Tracker();
    const [leg] = after.status().pending;
    expect(leg).toMatchObject({ sim_departed_at: null, sim_arrived_at: null });
  });
});

describe("the sim-clock times in the logbook (LOG-REC-002)", () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startTestServer();
  });
  afterAll(async () => {
    await server.close();
  });
  beforeEach(() => {
    resetLogbook();
  });

  // @spec LOG-REC-002
  it("keeps them in nullable columns of the hops table, with no default", () => {
    const cols = db.prepare(`PRAGMA table_info(hops)`).all() as { name: string; notnull: number; dflt_value: unknown }[];
    for (const name of ["sim_departed_at", "sim_arrived_at"]) {
      const col = cols.find((c) => c.name === name);
      expect(col, name).toBeDefined();
      expect(col!.notnull).toBe(0);
      expect(col!.dflt_value).toBeNull();
    }
  });

  // @spec LOG-REC-002
  it("lets a hop be logged without them, as an older version of the app logs one, and reads them back as null", async () => {
    const id = fleetAircraft();
    db.prepare(
      `INSERT INTO hops (aircraft_id, seq, origin, dest, departed_at, arrived_at, duration_min, notes, track, landings, stats, briefing_id)
       VALUES (?, 1, 'KPVD', 'KBOS', '2026-10-24T12:00:00.000Z', '2026-10-24T12:40:00.000Z', 40, '', NULL, NULL, NULL, NULL)`,
    ).run(id);
    const res = await fetch(`${server.base}/api/hops?aircraft_id=${id}`);
    const [hop] = await res.json();
    expect(hop).toMatchObject({ origin: "KPVD", dest: "KBOS", sim_departed_at: null, sim_arrived_at: null });
  });

  // @spec LOG-REC-002
  it("returns a tracked hop's sim-clock times from the hop API, and keeps them when the hop is edited", async () => {
    const id = fleetAircraft();
    db.prepare(
      `INSERT INTO hops (aircraft_id, seq, origin, dest, departed_at, arrived_at, duration_min, notes, sim_departed_at, sim_arrived_at)
       VALUES (?, 1, 'KPVD', 'KBOS', '2026-10-24T12:00:00.000Z', '2026-10-24T12:40:00.000Z', 40, '', '2026-03-01T06:45:00.000Z', '2026-03-01T07:25:00.000Z')`,
    ).run(id);
    const [hop] = await (await fetch(`${server.base}/api/hops?aircraft_id=${id}`)).json();
    expect(hop).toMatchObject({ sim_departed_at: "2026-03-01T06:45:00.000Z", sim_arrived_at: "2026-03-01T07:25:00.000Z" });

    const put = await fetch(`${server.base}/api/hops/${hop.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notes: "edited" }),
    });
    expect(put.status).toBe(200);
    expect(await put.json()).toMatchObject({ notes: "edited", sim_departed_at: "2026-03-01T06:45:00.000Z", sim_arrived_at: "2026-03-01T07:25:00.000Z" });
  });

  // @spec LOG-REC-002
  it("takes optional sim-clock times on a hop created or edited through the hop API", async () => {
    const id = fleetAircraft();
    const created = await fetch(`${server.base}/api/hops`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ aircraft_id: id, origin: "KPVD", dest: "KBOS", sim_departed_at: "2026-03-01T06:45:00Z" }),
    });
    expect(created.status).toBe(201);
    const hop = await created.json();
    expect(hop).toMatchObject({ sim_departed_at: "2026-03-01T06:45:00.000Z", sim_arrived_at: null });

    const edited = await fetch(`${server.base}/api/hops/${hop.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sim_arrived_at: "2026-03-01T07:25:00Z" }),
    });
    expect(await edited.json()).toMatchObject({ sim_departed_at: "2026-03-01T06:45:00.000Z", sim_arrived_at: "2026-03-01T07:25:00.000Z" });

    const bad = await fetch(`${server.base}/api/hops/${hop.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sim_arrived_at: "not a time" }),
    });
    expect(bad.status).toBe(400);
  });
});
