/**
 * Restoring a checkpoint that holds a part the tracker cannot read: a damaged pending leg is set
 * aside alone and the other pending legs are restored in order (LIVE-SAVE-013); a damaged leg in
 * progress is set aside alone and the tracker starts that part from idle, the rest restored as
 * written (LIVE-SAVE-014). Neither sets the whole checkpoint aside (the boundary of LIVE-SAVE-007).
 * Each part set aside is one `tracker_state_aside` row with its JSON and the time, one error line,
 * and a checkpoint written without it before the constructor returns.
 */
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { Tracker, type HopEvent } from "../../src/server/tracker.ts";
import { KPVD, PLANE, fleetAircraft, pilot } from "./pilot.ts";
import { addBriefing, asideRows, hopCount, readCheckpoint, resetLogbook, writeCheckpoint } from "./state.ts";

/** The clock while the tracker restores: the time a part set aside is stamped with. */
const NOW = Date.parse("2026-10-12T11:59:59Z");

const PENDING_LINE = "[tracker] set aside a pending leg it cannot read (";
const LEG_LINE = "[tracker] set aside the leg in progress it cannot read (";
const WHOLE_LINE = "[tracker] set aside a checkpoint it cannot read (";

/** Every field of a hop's statistics. */
const STAT_KEYS = ["fuel_start_lb", "fuel_end_lb", "fuel_used_lb", "weight_start_lb", "weight_end_lb", "max_alt_ft", "max_gs_kts", "flown_nm"];
const noStats = () => Object.fromEntries(STAT_KEYS.map((k) => [k, null]));

type Json = Record<string, any>;

/** A track point as the tracker writes it: [lat, lon, alt_ft, unix_seconds, gs_kts, vs_fpm, ias_kts, fuel_lb]. */
const GOOD_POINT = [41.7246, -71.4282, 60, 1760266800, 0, 0, 0, 300];

/** A touchdown as the tracker writes it. */
const TOUCHDOWN = {
  t: "2026-10-12T11:30:00.000Z", fpm: 140, g: 1.3, ias_kts: 62, sim_fpm: 138, pitch_deg: 3.1, bank_deg: 0.4,
  lat: 41.7246, lon: -71.4282, rating: "solid", source: "frames",
};

/** A pending leg this version reads, as a checkpoint holds it. */
function pendingEntry(over: Json = {}): Json {
  return {
    id: randomUUID(),
    sim: { ...PLANE },
    aircraft_id: null,
    origin: "KPVD",
    dest: null,
    departed_at: "2026-10-12T11:00:00.000Z",
    arrived_at: "2026-10-12T11:30:00.000Z",
    duration_min: 30,
    track: [
      [41.7246, -71.4282, 60, 1760266800, 0, 0, 0, 300],
      [41.8, -71.4282, 1500, 1760267400, 100, 0, 100, 290],
    ],
    landings: [],
    stats: noStats(),
    briefing_id: null,
    reason: "no airport within 5 nm of where it stopped",
    ended_in_air: false,
    ...over,
  };
}

/** That entry with one field taken out. */
function without(entry: Json, key: string): Json {
  const copy = structuredClone(entry);
  delete copy[key];
  return copy;
}

/** A checkpoint on the ground with nothing in progress, holding these pending entries. */
function groundCheckpoint(pending: unknown): Json {
  return {
    phase: "ground",
    sim: { ...PLANE },
    aircraft_id: null,
    leg: null,
    pending,
    briefing: null,
    casual: null,
    last: null,
    lastGround: null,
    lastAirborne: null,
    airborneSince: null,
    stopSince: null,
    message: null,
    message_at: null,
  };
}

/** The rows set aside, oldest first, by the table's columns (id, json, set_aside_at): each part parsed, with its time. */
const asideParts = () => asideRows().map(([, json, at]) => ({ part: JSON.parse(json as string) as unknown, at }));

const ids = (list: { id: string }[]) => list.map((l) => l.id);

/** The pending entries a test damages, each put between two good pending legs. */
const BAD_ENTRIES: [string, () => unknown][] = [
  ['"x"', () => "x"],
  ["null", () => null],
  ["[1]", () => [1]],
  ["a missing sim", () => without(pendingEntry(), "sim")],
  ['sim: {title: 5, livery: ""}', () => pendingEntry({ sim: { title: 5, livery: "" } })],
  ["a missing departed_at", () => without(pendingEntry(), "departed_at")],
  ["arrived_at: 5", () => pendingEntry({ arrived_at: 5 })],
  ['duration_min: "40"', () => pendingEntry({ duration_min: "40" })],
  ["a missing reason", () => without(pendingEntry(), "reason")],
  ["track: {}", () => pendingEntry({ track: {} })],
  ["a track holding a null point", () => pendingEntry({ track: [GOOD_POINT, null] })],
  ["a track point of three numbers", () => pendingEntry({ track: [GOOD_POINT, [41.8, -71.4282, 1500]] })],
  ['a track point holding a string', () => pendingEntry({ track: [[41.7246, "-71.4282", 60, 1760266800]] })],
  ['landings: "none"', () => pendingEntry({ landings: "none" })],
  ["landings: [null]", () => pendingEntry({ landings: [null] })],
  ["a touchdown with no t", () => pendingEntry({ landings: [{ fpm: 120, rating: "solid" }] })],
  ["stats: []", () => pendingEntry({ stats: [] })],
  ['ended_in_air: "yes"', () => pendingEntry({ ended_in_air: "yes" })],
];

// ------------------------------------------------------------------ the leg in progress

const T_DEPART = Date.parse("2026-10-12T11:50:00Z");
const T_LAST = Date.parse("2026-10-12T11:59:50Z");
const CASUAL_SINCE = Date.parse("2026-10-12T11:40:00Z");

/** A leg in progress this version reads, airborne 3 nm north of KPVD. */
function goodLeg(): Json {
  return {
    origin: "KPVD",
    departed_at: T_DEPART,
    touchdown_at: null,
    track: [
      [41.7246, -71.4282, 60, T_DEPART / 1000 - 1, 0, 0, 0, 300],
      [41.7746, -71.4282, 1500, T_LAST / 1000, 100, 0, 100, 290],
    ],
    landings: [],
    fuel_start_lb: 300,
    weight_start_lb: 2400,
    max_alt_ft: 1500,
    max_gs_kts: 100,
  };
}

/** The legs in progress a test damages. */
const BAD_LEGS: [string, () => unknown][] = [
  ['"x"', () => "x"],
  ["[]", () => []],
  ['{departed_at: "noon", track: []}', () => ({ departed_at: "noon", track: [] })],
  ["a missing track", () => without(goodLeg(), "track")],
  ["track: {}", () => ({ ...goodLeg(), track: {} })],
  ['landings: "x"', () => ({ ...goodLeg(), landings: "x" })],
  ["origin: 5", () => ({ ...goodLeg(), origin: 5 })],
  ['touchdown_at: "x"', () => ({ ...goodLeg(), touchdown_at: "x" })],
  ['fuel_start_lb: "x"', () => ({ ...goodLeg(), fuel_start_lb: "x" })],
  ['max_alt_ft: "high"', () => ({ ...goodLeg(), max_alt_ft: "high" })],
  ["a first track point that is not a point", () => ({ ...goodLeg(), track: [5, goodLeg().track[1]] })],
  ["a track holding a null point", () => ({ ...goodLeg(), track: [...goodLeg().track, null] })],
  ["a track point holding null", () => ({ ...goodLeg(), track: [goodLeg().track[0], [41.7746, null, 1500, T_LAST / 1000]] })],
  ["landings: [null]", () => ({ ...goodLeg(), landings: [null] })],
  ["a touchdown whose t is a number", () => ({ ...goodLeg(), landings: [{ ...TOUCHDOWN, t: T_LAST }] })],
];

function sample(over: Json): Json {
  return {
    t: T_LAST, lat: KPVD.lat + 0.05, lon: KPVD.lon, alt_ft: 1500, on_ground: false, gs_kts: 100, hdg_deg: 0, vs_fpm: 0,
    ias_kts: 100, g: 1, fuel_lb: 290, weight_lb: 2390, ...PLANE, ...over,
  };
}

/**
 * An airborne checkpoint holding `leg` and everything else a restore keeps: a bound aircraft, the
 * sim aircraft, a good pending leg, a briefing, casual mode on, the last samples, both timers and
 * the message.
 */
function airborneCheckpoint(leg: unknown, aircraftId: number, briefing: unknown, pending: Json): Json {
  const last = sample({});
  return {
    phase: "airborne",
    sim: { ...PLANE },
    aircraft_id: aircraftId,
    leg,
    pending: [pending],
    briefing,
    casual: { since: CASUAL_SINCE },
    last,
    lastGround: sample({ t: T_DEPART - 1000, lat: KPVD.lat, alt_ft: 60, on_ground: true, gs_kts: 0, ias_kts: 0, fuel_lb: 300, weight_lb: 2400 }),
    lastAirborne: last,
    airborneSince: T_DEPART,
    stopSince: T_LAST - 2000,
    message: "Took off from KPVD",
    message_at: "2026-10-12T11:50:00.000Z",
  };
}

describe("restoring a checkpoint with a part it cannot read", () => {
  let err: MockInstance<typeof console.error>;
  /** The error lines written so far, each as its first argument. */
  const lines = () => err.mock.calls.map((c) => String(c[0]));
  const linesStarting = (prefix: string) => lines().filter((l) => l.startsWith(prefix));

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    resetLogbook();
    err = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("a pending leg it cannot read", () => {
    // @spec LIVE-SAVE-013
    it.each(BAD_ENTRIES)(
      "sets aside a pending entry that is %s alone, restores the good legs either side in order, and writes the checkpoint without it at once",
      (_, make) => {
        const bad = make();
        const a = pendingEntry({ reason: "no fleet aircraft is bound to this sim aircraft" });
        const b = pendingEntry({ origin: null, reason: "the departure airport is unknown" });
        writeCheckpoint(groundCheckpoint([a, bad, b]));

        const tr = new Tracker();

        // Right after the constructor: one row holding the entry, and a checkpoint without it.
        expect(asideParts()).toEqual([{ part: bad, at: new Date(NOW).toISOString() }]);
        expect(ids(readCheckpoint()!.pending)).toEqual([a.id, b.id]);
        expect(ids(tr.status().pending)).toEqual([a.id, b.id]);
        expect(linesStarting(PENDING_LINE)).toHaveLength(1);
        expect(linesStarting(WHOLE_LINE)).toEqual([]);
        expect(linesStarting(LEG_LINE)).toEqual([]);

        // The next start finds nothing more to set aside.
        const again = new Tracker();
        expect(asideRows()).toHaveLength(1);
        expect(ids(again.status().pending)).toEqual([a.id, b.id]);
      },
    );

    // @spec LIVE-SAVE-013
    it("sets aside two bad entries as two rows, in the order the checkpoint holds them", () => {
      const a = pendingEntry();
      const b = pendingEntry();
      const first = "x";
      const second = without(pendingEntry(), "reason");
      writeCheckpoint(groundCheckpoint([a, first, b, second]));

      const tr = new Tracker();
      expect(asideParts().map((r) => r.part)).toEqual([first, second]);
      expect(linesStarting(PENDING_LINE)).toHaveLength(2);
      expect(ids(tr.status().pending)).toEqual([a.id, b.id]);
      expect(ids(readCheckpoint()!.pending)).toEqual([a.id, b.id]);
    });

    // @spec LIVE-SAVE-013
    it("sets aside an older version's single pending leg it cannot read, leaving no pending leg", () => {
      const legacy = without(without(pendingEntry(), "id"), "sim");
      writeCheckpoint(groundCheckpoint(legacy));

      const tr = new Tracker();
      expect(asideParts()).toEqual([{ part: legacy, at: new Date(NOW).toISOString() }]);
      expect(tr.status().pending).toEqual([]);
      expect(readCheckpoint()!.pending ?? []).toEqual([]);
      expect(linesStarting(PENDING_LINE)).toHaveLength(1);
      expect(linesStarting(WHOLE_LINE)).toEqual([]);
    });

    // @spec LIVE-SAVE-013
    it("restores a pending leg with an older version's four-field points and a touchdown, and logs it", () => {
      const aircraftId = fleetAircraft();
      const leg = pendingEntry({
        aircraft_id: aircraftId,
        dest: "KPVD",
        track: [GOOD_POINT.slice(0, 4), [41.8, -71.4282, 1500, 1760267400]],
        landings: [TOUCHDOWN],
      });
      writeCheckpoint(groundCheckpoint([leg]));

      const tr = new Tracker();
      expect(asideRows()).toEqual([]);
      expect(lines()).toEqual([]);
      expect(tr.pendingLeg(leg.id)).toMatchObject({ track: leg.track, landings: [TOUCHDOWN] });
      const logged: HopEvent[] = [];
      tr.on("hop", (h: HopEvent) => logged.push(h));
      tr.savePending(leg.id, {});
      expect(logged.map((h) => h.message)).toEqual(["Logged KPVD → KPVD, 30 min, 140 fpm solid"]);
      expect(hopCount()).toBe(1);
    });

    // @spec LIVE-SAVE-013, LIVE-SAVE-002
    it.each([
      ["null", null],
      ["absent", undefined],
    ])("restores a pending leg whose track, landings, stats and ended_in_air are %s, with their defaults", (_, value) => {
      let leg = pendingEntry();
      for (const k of ["track", "landings", "stats", "ended_in_air"]) leg = value === undefined ? without(leg, k) : { ...leg, [k]: null };
      writeCheckpoint(groundCheckpoint([leg]));

      const tr = new Tracker();
      expect(asideRows()).toEqual([]);
      expect(lines()).toEqual([]);
      const [listed] = tr.status().pending;
      expect(listed).toMatchObject({ id: leg.id, landings: [], points: 0, ended_in_air: false });
      const full = tr.pendingLeg(leg.id)!;
      expect(full.track).toEqual([]);
      expect(full.landings).toEqual([]);
      expect(full.stats).toEqual(noStats());
      expect(full.ended_in_air).toBe(false);
    });
  });

  describe("a leg in progress it cannot read", () => {
    // @spec LIVE-SAVE-014
    it.each(BAD_LEGS)(
      "sets aside a leg that is %s alone, starts that part from idle and restores the rest as written",
      (_, make) => {
        const bad = make();
        const aircraftId = fleetAircraft();
        const briefing = addBriefing();
        const waiting = pendingEntry();
        const written = airborneCheckpoint(bad, aircraftId, briefing, waiting);
        writeCheckpoint(written);

        const tr = new Tracker();

        // One row holding the leg, and the line for it.
        expect(asideParts()).toEqual([{ part: bad, at: new Date(NOW).toISOString() }]);
        expect(linesStarting(LEG_LINE)).toHaveLength(1);
        expect(linesStarting(WHOLE_LINE)).toEqual([]);

        // The status: idle with no leg, and the rest as written.
        const st = tr.status();
        expect(st.phase).toBe("idle");
        expect(st.leg).toBeNull();
        expect(st.sim).toEqual(PLANE);
        expect(st.aircraft_id).toBe(aircraftId);
        expect(ids(st.pending)).toEqual([waiting.id]);
        expect(st.briefing).toEqual(briefing);
        expect(st.casual).toEqual({ since: new Date(CASUAL_SINCE).toISOString(), points: 0 });
        expect(st.message).toBe(written.message);

        // The checkpoint, right after the constructor: no leg, idle, no timer and no last on-ground
        // or airborne sample; the rest as written.
        const cp = readCheckpoint()!;
        expect(cp).toMatchObject({
          leg: null,
          phase: "idle",
          airborneSince: null,
          stopSince: null,
          lastGround: null,
          lastAirborne: null,
          sim: PLANE,
          aircraft_id: aircraftId,
          briefing: { id: briefing.id },
          casual: { since: CASUAL_SINCE },
          last: written.last,
          message: written.message,
        });
        expect(ids(cp.pending)).toEqual([waiting.id]);

        // The next on-ground sample begins tracking afresh. Casual mode, on as written, is switched
        // off first: in casual mode no sample moves the phase.
        tr.setCasual(false);
        const p = pilot(tr);
        p.ground(1);
        const next = tr.status();
        expect(next.phase).toBe("ground");
        expect(next.leg).toBeNull();
        expect(ids(next.pending)).toEqual([waiting.id]);
        expect(hopCount()).toBe(0);
      },
    );

    // @spec LIVE-SAVE-014
    it("restores a leg whose touchdown_at, origin and landings are null", () => {
      const leg = { ...goodLeg(), touchdown_at: null, origin: null, landings: null };
      writeCheckpoint({ ...airborneCheckpoint(leg, fleetAircraft(), null, pendingEntry()), casual: null });

      const st = new Tracker().status();
      expect(asideRows()).toEqual([]);
      expect(linesStarting(LEG_LINE)).toEqual([]);
      expect(st.phase).toBe("airborne");
      expect(st.leg).toMatchObject({ origin: null, touchdown_at: null, landings: [], departed_at: new Date(T_DEPART).toISOString() });
    });
  });

  // @spec LIVE-SAVE-013, LIVE-SAVE-014
  it("sets aside a bad leg and a bad pending entry together as two rows, writing both lines", () => {
    const badLeg = { ...goodLeg(), origin: 5 };
    const badEntry = pendingEntry({ duration_min: "40" });
    const good = pendingEntry();
    const written = airborneCheckpoint(badLeg, fleetAircraft(), null, good);
    writeCheckpoint({ ...written, pending: [badEntry, good] });

    const tr = new Tracker();
    const parts = asideParts().map((r) => r.part);
    expect(parts).toHaveLength(2);
    expect(parts).toEqual(expect.arrayContaining([badLeg, badEntry]));
    expect(linesStarting(LEG_LINE)).toHaveLength(1);
    expect(linesStarting(PENDING_LINE)).toHaveLength(1);
    expect(linesStarting(WHOLE_LINE)).toEqual([]);
    expect(tr.status()).toMatchObject({ phase: "idle", leg: null });
    expect(ids(tr.status().pending)).toEqual([good.id]);
    expect(readCheckpoint()).toMatchObject({ leg: null, phase: "idle" });
    expect(ids(readCheckpoint()!.pending)).toEqual([good.id]);
  });
});
