/**
 * The tracker's checkpoint: when it is saved (LIVE-SAVE-001), saving on request (LIVE-SAVE-004),
 * restoring an older checkpoint (LIVE-SAVE-002), setting aside one it cannot read as a whole (LIVE-SAVE-007),
 * keeping fields it does not know (LIVE-SAVE-012), and logging a hop in one transaction with the
 * checkpoint that no longer holds its leg (LIVE-SAVE-006).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../src/server/db.ts";
import { Tracker, type TrackPoint } from "../../src/server/tracker.ts";
import { NOWHERE, OTHER, PLANE, fleetAircraft, flyCircuit, pilot, takeOff, type Pilot } from "./pilot.ts";
import {
  addBriefing,
  asideRows,
  briefingHopId,
  hopCount,
  hopRows,
  rawCheckpoint,
  readCheckpoint,
  resetLogbook,
  writeCheckpoint,
} from "./state.ts";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/** SQL that makes one kind of write to a table fail, as a full disk would. */
const failWrites = (name: string, when: "INSERT" | "UPDATE", table: string) =>
  `CREATE TEMP TRIGGER ${name} BEFORE ${when} ON ${table} BEGIN SELECT RAISE(ABORT, 'disk full'); END;`;
const CHECKPOINT_FAILS = {
  fail_upd: failWrites("fail_upd", "UPDATE", "tracker_state"),
  fail_ins: failWrites("fail_ins", "INSERT", "tracker_state"),
};
const HOP_FAILS = { fail_hop: failWrites("fail_hop", "INSERT", "hops") };
const BRIEFING_LINK_FAILS = { fail_brf: failWrites("fail_brf", "UPDATE", "briefings") };
/** Each of the three writes logging a hop makes, to be failed in turn. */
const FAILING_WRITES: [string, Record<string, string>][] = [
  ["checkpoint", CHECKPOINT_FAILS],
  ["hop", HOP_FAILS],
  ["briefing's link", BRIEFING_LINK_FAILS],
];

/** Every field of a hop's statistics. */
const STAT_KEYS = ["fuel_start_lb", "fuel_end_lb", "fuel_used_lb", "weight_start_lb", "weight_end_lb", "max_alt_ft", "max_gs_kts", "flown_nm"];

/** Run `fn` while the given writes fail, dropping the triggers afterwards whatever happens. */
function whileFailing(triggers: Record<string, string>, fn: () => void): void {
  for (const sql of Object.values(triggers)) db.exec(sql);
  try {
    fn();
  } finally {
    for (const name of Object.keys(triggers)) db.exec(`DROP TRIGGER IF EXISTS ${name}`);
  }
}

/** Samples in a sim aircraft other than the pilot's own, on the pilot's clock and position. */
function flying(p: Pilot, sim: typeof PLANE) {
  return {
    ground: (n: number, gs = 0) => {
      for (let i = 0; i < n; i++) p.feed({ ...sim, on_ground: true, gs_kts: gs, alt_ft: 60 });
    },
    air: (n: number, gs = 100) => {
      for (let i = 0; i < n; i++) p.feed({ ...sim, on_ground: false, gs_kts: gs, alt_ft: 1500, vs_fpm: 0, ias_kts: gs });
    },
  };
}

/** Fly on until the 5 s throttle has just saved, then one sample more, which the checkpoint does not hold yet. */
function flyPastASave(p: Pilot): void {
  const before = rawCheckpoint();
  for (let i = 0; i < 10 && rawCheckpoint() === before; i++) p.air(1);
  p.air(1);
}

const ids = (list: { id: string }[]) => list.map((x) => x.id);

/** A checkpoint as an older version wrote it: one pending leg, without an id, in place of a list. */
function olderCheckpoint(): Record<string, any> {
  const sim = { ...PLANE };
  return {
    phase: "ground",
    sim,
    aircraft_id: null,
    leg: null,
    pending: {
      sim,
      aircraft_id: null,
      origin: "KPVD",
      dest: null,
      departed_at: "2026-10-12T11:00:00.000Z",
      arrived_at: "2026-10-12T11:30:00.000Z",
      duration_min: 30,
      track: [[41.72, -71.43, 60, 1760270400, 0, 0, 0, 300]],
      landings: [],
      stats: {
        fuel_start_lb: null,
        fuel_end_lb: null,
        fuel_used_lb: null,
        weight_start_lb: null,
        weight_end_lb: null,
        max_alt_ft: null,
        max_gs_kts: null,
        flown_nm: null,
      },
      briefing_id: null,
      reason: "no airport within 5 nm of where it stopped",
    },
    briefing: null,
    last: null,
    lastGround: null,
    lastAirborne: null,
    airborneSince: null,
    stopSince: null,
    message: null,
    message_at: null,
  };
}

/**
 * A checkpoint as v0.7 wrote it: one pending leg with no id, landings, statistics or briefing, its
 * track points of four fields, and none of the fields later versions added to the checkpoint itself.
 */
function v07Checkpoint(): Record<string, any> {
  const sim = { ...PLANE };
  return {
    phase: "ground",
    sim,
    aircraft_id: null,
    leg: null,
    pending: {
      sim,
      aircraft_id: null,
      origin: "KPVD",
      dest: null,
      departed_at: "2026-10-05T11:00:00.000Z",
      arrived_at: "2026-10-05T11:30:00.000Z",
      duration_min: 30,
      track: [
        [41.7246, -71.4282, 60, 1759662000],
        [41.8, -71.4282, 1500, 1759662600],
      ],
      reason: "no airport within 5 nm of where it stopped",
    },
    last: null,
    lastGround: null,
    airborneSince: null,
    stopSince: null,
    message: null,
    message_at: null,
  };
}

describe("the tracker's checkpoint", () => {
  let tr: Tracker;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // Just before the pilot's first sample, so the tracker never sees the clock run backwards.
    vi.setSystemTime(Date.parse("2026-10-12T11:59:00Z"));
    resetLogbook();
    tr = new Tracker();
    tr.setConnected(true, "Fake MSFS");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("when it is saved", () => {
    // @spec LIVE-SAVE-001
    it("saves a leg at once when it starts: at the takeoff confirmation and when tracking starts in the air", () => {
      const p = pilot(tr);
      p.ground(3);
      p.air(5);
      expect(tr.status().leg).toBeNull();
      tr.setBriefing(addBriefing());
      p.air(1);
      expect(tr.status().leg?.origin).toBe("KPVD");
      let cp = readCheckpoint()!;
      expect(cp.phase).toBe("airborne");
      expect(cp.leg).toMatchObject({ origin: "KPVD" });

      // Discarded, the next airborne sample starts a leg in the air at once.
      tr.discardLeg("test");
      p.air(1);
      expect(tr.status().leg).not.toBeNull();
      cp = readCheckpoint()!;
      expect(cp.phase).toBe("airborne");
      expect(cp.leg).toMatchObject({ origin: null });
    });

    // @spec LIVE-SAVE-001
    it("saves a touchdown at once, with its provisional landing", () => {
      const p = pilot(tr);
      takeOff(p);
      p.air(80);
      p.home();
      tr.setBriefing(addBriefing());
      p.ground(1, 30);
      expect(tr.status().phase).toBe("landed");
      const cp = readCheckpoint()!;
      expect(cp.phase).toBe("landed");
      expect(cp.leg.landings).toHaveLength(1);
    });

    // @spec LIVE-SAVE-001
    it("saves a measured landing at once when it replaces the provisional one, and when it is added as a landing of its own", () => {
      const p = pilot(tr);
      takeOff(p);
      p.air(80);
      p.home();
      p.feed({ on_ground: true, gs_kts: 50 });
      tr.setBriefing(addBriefing());
      expect(readCheckpoint()!.leg.landings).toMatchObject([{ source: "samples" }]);

      p.feed({
        on_ground: true,
        gs_kts: 40,
        touchdown: { t: p.t, fpm: 300, g: 1.7, ias_kts: 60, sim_fpm: 290, pitch_deg: 3, bank_deg: 0 },
      });
      expect(tr.status().leg?.landings).toMatchObject([{ source: "frames", fpm: 300 }]);
      expect(readCheckpoint()!.leg.landings).toMatchObject([{ source: "frames", fpm: 300 }]);

      // A second measured touchdown 8 s on, with no provisional landing near it: added, not replacing.
      p.ground(7, 30);
      tr.setBriefing(addBriefing()); // a save just now, so the 5 s throttle would not save the next sample
      p.feed({
        on_ground: true,
        gs_kts: 30,
        touchdown: { t: p.t, fpm: 120, g: 1.2, ias_kts: 45, sim_fpm: 110, pitch_deg: 2, bank_deg: 0 },
      });
      expect(tr.status().leg?.landings).toMatchObject([{ fpm: 300 }, { source: "frames", fpm: 120 }]);
      expect(readCheckpoint()!.leg.landings).toMatchObject([{ fpm: 300 }, { source: "frames", fpm: 120 }]);
    });

    // @spec LIVE-SAVE-001
    it("saves at once when a leg is kept as pending or discarded, and when the binding, the current briefing or the pending legs change", () => {
      const p = pilot(tr);
      flyCircuit(p); // unbound: kept as pending
      let cp = readCheckpoint()!;
      expect(cp.leg).toBeNull();
      expect(cp.pending).toHaveLength(1);

      const b = addBriefing();
      tr.setBriefing(b);
      expect(readCheckpoint()!.briefing?.id).toBe(b.id);

      // Binding sets the aircraft on the waiting leg flown in the same sim aircraft, and saves that too.
      const id = fleetAircraft();
      tr.bind(id);
      cp = readCheckpoint()!;
      expect(cp.aircraft_id).toBe(id);
      expect(cp.pending[0].aircraft_id).toBe(id);

      tr.discardPending(tr.status().pending[0].id);
      expect(readCheckpoint()!.pending).toEqual([]);

      takeOff(p);
      p.air(3);
      tr.discardLeg("test");
      cp = readCheckpoint()!;
      expect(cp.leg).toBeNull();
    });

    // @spec LIVE-SAVE-001
    it("saves casual mode at once, switched on with the time it was switched on, and switched off", () => {
      pilot(tr);
      const on = Date.now();
      tr.setCasual(true);
      expect(new Tracker().status().casual?.since).toBe(new Date(on).toISOString());

      tr.setCasual(false);
      expect(new Tracker().status().casual).toBeNull();
    });

    // @spec LIVE-SAVE-001
    it("saves at once when the binding changes while casual mode is on", () => {
      const planeId = fleetAircraft();
      const p = pilot(tr);
      const cub = flying(p, OTHER);
      tr.setCasual(true);
      cub.ground(1);
      expect(tr.status().aircraft_id).toBeNull();

      // Each change of aircraft comes within 5 s of the last save, so only a save at once holds it.
      p.ground(1); // into PLANE, bound
      expect(tr.status().aircraft_id).toBe(planeId);
      expect(readCheckpoint()).toMatchObject({ sim: { title: PLANE.title }, aircraft_id: planeId });

      cub.ground(1); // back into OTHER, bound to none
      expect(readCheckpoint()).toMatchObject({ sim: { title: OTHER.title }, aircraft_id: null });
    });

    // @spec LIVE-SAVE-001
    it("never saves the casual path", () => {
      const p = pilot(tr);
      tr.setCasual(true);
      p.moveTo(NOWHERE);
      p.air(30);
      const flown: TrackPoint[] = tr.path().flat();
      expect(flown.length).toBeGreaterThan(3);
      tr.setBriefing(addBriefing()); // a save holding the latest sample, past the path's last point

      const raw = rawCheckpoint()!;
      for (const pt of flown.slice(0, -1)) expect(raw).not.toContain(String(pt[0]));
      const after = new Tracker();
      expect(after.path()).toEqual([]);
      expect(after.status().casual?.points).toBe(0);
    });

    // @spec LIVE-SAVE-001
    it("otherwise saves at most every 5 s while samples arrive, and again with the sample 5 s after a save", () => {
      const p = pilot(tr);
      const saves: number[] = [];
      let raw = rawCheckpoint();
      for (let i = 0; i < 16; i++) {
        const s = p.feed({ on_ground: true, gs_kts: 0 });
        const now = rawCheckpoint();
        if (now !== raw) {
          saves.push(s.t);
          raw = now;
        }
      }
      expect(saves.length).toBeGreaterThanOrEqual(3);
      for (let i = 1; i < saves.length; i++) expect(saves[i] - saves[i - 1]).toBe(5000);
    });
  });

  describe("saving on request", () => {
    // @spec LIVE-SAVE-004
    it("writes the whole state at once, inside the 5 s throttle", () => {
      const p = pilot(tr);
      takeOff(p);
      p.air(20);
      flyPastASave(p);
      const latest = p.t - 1000;
      expect(readCheckpoint()!.last.t).toBeLessThan(latest);

      tr.saveNow();
      const cp = readCheckpoint()!;
      expect(cp.last.t).toBe(latest);
      expect(cp.phase).toBe("airborne");
      expect(cp.leg.track).toEqual(tr.track());
    });

    // @spec LIVE-SAVE-004
    it("changes nothing else: the same status, no event and the same message", () => {
      fleetAircraft();
      const p = pilot(tr);
      takeOff(p);
      p.air(20);
      flyPastASave(p);
      const before = tr.status();
      const events: string[] = [];
      for (const ev of ["status", "track", "point", "path", "path-point", "hop", "pending"]) tr.on(ev, () => events.push(ev));

      tr.saveNow();
      expect(events).toEqual([]);
      expect(tr.status()).toEqual(before);
      expect(tr.status().message).toBe(before.message);
    });

    // @spec LIVE-SAVE-004
    it("keeps casual mode and its path", () => {
      const p = pilot(tr);
      tr.setCasual(true);
      p.air(12);
      const path = structuredClone(tr.path());
      const casual = tr.status().casual;
      expect(casual).not.toBeNull();

      tr.saveNow();
      expect(readCheckpoint()!.last.t).toBe(p.t - 1000);
      expect(tr.path()).toEqual(path);
      expect(tr.status().casual).toEqual(casual);
    });

    // @spec LIVE-SAVE-004
    it("keeps a running stop timer: the leg still closes 30 s after the stop began", () => {
      const p = pilot(tr);
      takeOff(p);
      p.air(80);
      p.home();
      p.ground(5, 30);
      p.ground(10); // stopped for 10 s
      tr.saveNow();
      p.ground(20); // 29 s after the stop began
      expect(tr.status().leg).not.toBeNull();
      p.ground(1); // 30 s
      expect(tr.status().leg).toBeNull();
    });
  });

  describe("restoring an older checkpoint", () => {
    // @spec LIVE-SAVE-002
    it("reads a single pending leg as a list of that one leg, with an id of its own that holds across restarts", () => {
      const older = olderCheckpoint();
      writeCheckpoint(older);
      const pending = new Tracker().status().pending;
      expect(pending).toHaveLength(1);
      const { track: _track, ...kept } = older.pending;
      expect(pending[0]).toMatchObject({ ...kept, points: 1 });
      expect(pending[0].id).toMatch(UUID_V4);

      expect(ids(new Tracker().status().pending)).toEqual([pending[0].id]);
    });

    // @spec LIVE-SAVE-002
    it("reads an older checkpoint's empty pending leg, or none at all, as an empty list", () => {
      writeCheckpoint({ ...olderCheckpoint(), pending: null });
      expect(new Tracker().status().pending).toEqual([]);

      const { pending: _pending, ...withoutPending } = olderCheckpoint();
      writeCheckpoint(withoutPending);
      expect(new Tracker().status().pending).toEqual([]);
    });

    // @spec LIVE-SAVE-002
    it("gives a leg saved without landings or statistics empty ones", () => {
      const t = Date.parse("2026-10-12T11:50:00Z");
      writeCheckpoint({
        ...olderCheckpoint(),
        phase: "airborne",
        pending: null,
        leg: {
          origin: "KPVD",
          departed_at: t,
          touchdown_at: null,
          track: [
            [41.7246, -71.4282, 60, t / 1000],
            [41.73, -71.4282, 1500, t / 1000 + 5],
          ],
        },
      });
      const st = new Tracker().status();
      expect(st.phase).toBe("airborne");
      expect(st.leg).toMatchObject({ origin: "KPVD", landings: [] });
      expect(Number.isFinite(st.leg!.max_alt_ft)).toBe(true);
    });

    // @spec LIVE-SAVE-002
    it("gives a pending leg v0.7 saved, without landings, statistics or a briefing, empty ones and an id of its own", () => {
      writeCheckpoint(v07Checkpoint());
      const pending = new Tracker().status().pending;
      expect(pending).toHaveLength(1);
      const [leg] = pending;
      expect(leg).toMatchObject({ origin: "KPVD", dest: null, landings: [], briefing_id: null, points: 2 });
      expect(leg.id).toMatch(UUID_V4);
      expect(leg.stats).toBeTypeOf("object");
      expect(leg.stats).not.toBeNull();
      for (const k of STAT_KEYS) expect(leg.stats).toHaveProperty(k);
    });

    // @spec LIVE-SAVE-002
    it("drops a saved leg that began within 0.05° of latitude 0 and longitude 0, restoring the rest", () => {
      const t = Date.parse("2026-10-12T11:50:00Z");
      writeCheckpoint({
        ...olderCheckpoint(),
        phase: "airborne",
        pending: null,
        leg: {
          origin: null,
          departed_at: t,
          touchdown_at: null,
          track: [[0.01, -0.02, 30000, t / 1000, 0, 0, 0, 300]],
          landings: [],
          fuel_start_lb: 300,
          weight_start_lb: 2400,
          max_alt_ft: 30000,
          max_gs_kts: 0,
        },
      });
      const st = new Tracker().status();
      expect(st.phase).toBe("idle");
      expect(st.leg).toBeNull();
      expect(st.sim).toMatchObject({ title: PLANE.title, livery: PLANE.livery });
      expect(asideRows()).toEqual([]);
    });
  });

  describe("logging a hop with its checkpoint", () => {
    /** An unbound circuit at KPVD flown with a SimBrief plan attached: kept as pending, carrying the plan. */
    function pendingWithBriefing() {
      const p = pilot(tr);
      const b = addBriefing();
      tr.setBriefing(b);
      flyCircuit(p);
      const [leg] = tr.status().pending;
      expect(leg.briefing_id).toBe(b.id);
      return { p, b, leg };
    }

    // @spec LIVE-SAVE-006
    it("writes the hop, its briefing's link and the checkpoint without the leg together when a leg closes", () => {
      fleetAircraft();
      const p = pilot(tr);
      const b = addBriefing();
      tr.setBriefing(b);
      let seen: { hops: ReturnType<typeof hopRows>; briefingHop: number | null | undefined; cp: Record<string, any> | null } | null = null;
      tr.on("hop", () => {
        seen = { hops: hopRows(), briefingHop: briefingHopId(b.id), cp: readCheckpoint() };
      });
      flyCircuit(p);

      expect(seen).not.toBeNull();
      const { hops, briefingHop, cp } = seen!;
      expect(hops).toHaveLength(1);
      expect(hops[0]).toMatchObject({ origin: "KPVD", dest: "KPVD", briefing_id: b.id });
      expect(briefingHop).toBe(hops[0].id);
      expect(cp!.leg).toBeNull();
    });

    // @spec LIVE-SAVE-006
    it("writes the hop, its briefing's link and the checkpoint without the pending leg together when a pending leg is logged", () => {
      const { b, leg } = pendingWithBriefing();
      let seen: { hops: ReturnType<typeof hopRows>; briefingHop: number | null | undefined; cp: Record<string, any> | null } | null = null;
      tr.on("hop", () => {
        seen = { hops: hopRows(), briefingHop: briefingHopId(b.id), cp: readCheckpoint() };
      });
      const hop = tr.savePending(leg.id, { aircraft_id: fleetAircraft(OTHER) });

      expect(seen).not.toBeNull();
      const { hops, briefingHop, cp } = seen!;
      expect(hops.map((h) => h.id)).toEqual([hop.id]);
      expect(briefingHop).toBe(hop.id);
      expect(ids(cp!.pending)).not.toContain(leg.id);
    });

    // @spec LIVE-SAVE-006
    it.each(FAILING_WRITES)("keeps a pending leg, logging nothing, when its %s cannot be written", (_, failing) => {
      const { b, leg } = pendingWithBriefing();
      const aircraft = fleetAircraft(OTHER);

      whileFailing(failing, () => {
        expect(() => tr.savePending(leg.id, { aircraft_id: aircraft })).toThrow(/disk full/);
      });
      expect(hopCount()).toBe(0);
      expect(briefingHopId(b.id)).toBeNull();
      expect(ids(readCheckpoint()!.pending)).toContain(leg.id);
      expect(ids(tr.status().pending)).toEqual([leg.id]);

      // With the disk back, the same leg is logged once.
      tr.savePending(leg.id, { aircraft_id: aircraft });
      expect(hopCount()).toBe(1);
      expect(briefingHopId(b.id)).toBe(hopRows()[0].id);
      expect(ids(readCheckpoint()!.pending)).not.toContain(leg.id);
    });

    // @spec LIVE-SAVE-006
    it.each(FAILING_WRITES)("keeps a closing leg in the checkpoint, logging nothing, when its %s cannot be written", (_, failing) => {
      fleetAircraft();
      const p = pilot(tr);
      const b = addBriefing();
      tr.setBriefing(b);
      takeOff(p);
      p.air(80);
      p.home();
      p.ground(5, 30);
      p.ground(30); // one sample short of closing
      expect(tr.status().phase).toBe("landed");

      whileFailing(failing, () => {
        try {
          p.ground(1);
        } catch {
          // The failed write may surface from feed; what matters is where the flight is kept.
        }
      });
      expect(hopCount()).toBe(0);
      expect(briefingHopId(b.id)).toBeNull();
      expect(readCheckpoint()!.leg).toMatchObject({ origin: "KPVD" });
      expect(tr.status().leg).not.toBeNull();

      // With the disk back, the next sample closes the leg and logs it once.
      p.wait(1);
      p.ground(1);
      expect(hopCount()).toBe(1);
      expect(briefingHopId(b.id)).toBe(hopRows()[0].id);
      expect(readCheckpoint()!.leg).toBeNull();
    });
  });

  describe("a checkpoint it cannot read", () => {
    /** The checkpoint after an unbound circuit: a real one, holding a pending leg. */
    function realCheckpoint(): Record<string, any> {
      flyCircuit(pilot(tr));
      const cp = readCheckpoint()!;
      expect(cp.pending).toBeTruthy();
      return cp;
    }

    const cases: { name: string; make: () => string }[] = [
      { name: "text that is not JSON", make: () => "{oops" },
      { name: "JSON that is not an object", make: () => "[1,2]" },
      {
        name: "a checkpoint without a phase",
        make: () => {
          const cp = realCheckpoint();
          delete cp.phase;
          return JSON.stringify(cp);
        },
      },
      { name: "a checkpoint with an unknown phase", make: () => JSON.stringify({ ...realCheckpoint(), phase: "cruising" }) },
      { name: "a checkpoint with mistyped pending legs", make: () => JSON.stringify({ ...realCheckpoint(), pending: "x" }) },
      // A pending list that is neither a list nor an object. A damaged entry of the list, or a
      // damaged leg in progress, is set aside alone instead (LIVE-SAVE-013, 014: set-aside.test.ts).
      { name: "a checkpoint whose pending legs are a number", make: () => JSON.stringify({ ...realCheckpoint(), pending: 7 }) },
      { name: "a checkpoint with a mistyped sim aircraft", make: () => JSON.stringify({ ...realCheckpoint(), sim: "x" }) },
    ];

    // @spec LIVE-SAVE-007
    it.each(cases)("sets aside $name whole, with the time, writes that out and starts empty", ({ make }) => {
      const text = make();
      writeCheckpoint(text);
      const err = vi.spyOn(console, "error").mockImplementation(() => {});

      const after = new Tracker();
      const rows = asideRows();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toContain(text);
      expect(rows[0].some((v) => typeof v === "string" && ISO_UTC.test(v))).toBe(true);
      expect(after.status()).toMatchObject({ phase: "idle", leg: null, pending: [], casual: null });
      expect(err.mock.calls.filter((c) => String(c[0]).startsWith("[tracker] set aside a checkpoint it cannot read ("))).toHaveLength(1);

      // The contract writes the empty state as the checkpoint at once, so the next start finds a
      // readable checkpoint and sets nothing more aside.
      const again = new Tracker();
      expect(asideRows()).toHaveLength(1);
      expect(again.status()).toMatchObject({ phase: "idle", leg: null, pending: [], casual: null });
    });
  });

  describe("fields it does not know", () => {
    // @spec LIVE-SAVE-012
    it("keeps each unknown field in every save while the checkpoint, the leg or the pending leg holding it is kept", () => {
      fleetAircraft(); // PLANE is bound, OTHER is not
      const p = pilot(tr, OTHER);
      flyCircuit(p); // kept as pending
      const plane = flying(p, PLANE);
      plane.ground(3);
      plane.air(30);
      tr.saveNow();

      const cp = readCheckpoint()!;
      expect(cp.leg).not.toBeNull();
      expect(cp.pending).toHaveLength(1);
      const pendingId: string = cp.pending[0].id;
      cp.future_top = { a: 1 };
      cp.leg.future_leg = "x";
      cp.pending[0].future_pending = [1, 2];
      writeCheckpoint(cp);

      const after = new Tracker();
      p.use(after);
      plane.air(3);
      after.saveNow();
      let saved = readCheckpoint()!;
      expect(saved.future_top).toEqual({ a: 1 });
      expect(saved.leg.future_leg).toBe("x");
      expect(saved.pending.find((x: { id: string }) => x.id === pendingId)?.future_pending).toEqual([1, 2]);

      // A pending leg's field goes with it; the checkpoint's stays.
      after.discardPending(pendingId);
      saved = readCheckpoint()!;
      expect(saved.pending).toEqual([]);
      expect(saved.future_top).toEqual({ a: 1 });

      // So does a leg's: the next leg starts without it.
      p.home();
      plane.ground(5, 30);
      plane.ground(35);
      expect(after.status().leg).toBeNull();
      plane.air(10);
      after.saveNow();
      saved = readCheckpoint()!;
      expect(saved.leg).not.toBeNull();
      expect(saved.leg).not.toHaveProperty("future_leg");
      expect(saved.future_top).toEqual({ a: 1 });
    });
  });
});
