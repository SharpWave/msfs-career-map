/**
 * Pending legs in the tracker: kept in a list in the order kept, each with a random UUID of its own
 * that the checkpoint keeps (LIVE-HOP-003); binding the sim aircraft sets that aircraft on every
 * waiting leg flown in the same title and livery that has none (LIVE-BIND-003); a leg in the air
 * when the sim link's connection ends is kept as pending, with the current briefing, and saved at
 * once (LIVE-LEG-008); a leg restored in the air at server start continues only when the first
 * sample the tracker takes resumes it, and is otherwise kept as pending — the sim's connection
 * ending before that sample included — never discarded or logged (LIVE-LEG-016); and each leg kept as pending is sent as a `pending` event as the status lists it
 * (LIVE-API-014).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Tracker, type PendingLegStatus } from "../../src/server/tracker.ts";
import { NOWHERE, OTHER, PLANE, fleetAircraft, flyCircuit, land, pilot, takeOff, type Pilot } from "./pilot.ts";
import { addBriefing, hopCount, readCheckpoint, resetLogbook } from "./state.ts";

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SimAircraft = typeof PLANE;

/** The pending legs as the tracker's status lists them. */
const listed = (t: Tracker): PendingLegStatus[] => t.status().pending;

/**
 * A pilot whose sim aircraft can change between legs: the pilot reads its sim object afresh for
 * every sample, so `fly(next)` switches the aircraft from the next sample on.
 */
function pilotIn(tr: Tracker, start: SimAircraft) {
  const sim = { ...start };
  const p = pilot(tr, sim);
  return { p, fly: (next: SimAircraft) => void Object.assign(sim, next) };
}

/** Take off where no airport lies within 5 nm, fly a while and land back at KPVD: a leg with no departure airport. */
function circuitFromNowhere(p: Pilot) {
  p.moveTo(NOWHERE);
  takeOff(p);
  p.air(80);
  land(p);
}

describe("pending legs", () => {
  let tr: Tracker;

  beforeEach(() => {
    resetLogbook();
    vi.useFakeTimers({ toFake: ["Date"] });
    tr = new Tracker();
    tr.setConnected(true, "Fake MSFS");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("the list", () => {
    /** PLANE is bound to a fleet aircraft and OTHER to none; flying starts in OTHER over KPVD. */
    function twoKinds() {
      fleetAircraft();
      const { p, fly } = pilotIn(tr, OTHER);
      return {
        /** A circuit at KPVD in OTHER, kept because no fleet aircraft is bound to it. */
        unbound: () => {
          fly(OTHER);
          flyCircuit(p);
        },
        /** A circuit in PLANE from where no airport is near, kept because its departure is unknown. */
        noDeparture: () => {
          fly(PLANE);
          circuitFromNowhere(p);
        },
      };
    }

    // @spec LIVE-HOP-003
    it("keeps every pending leg in the order kept, each with a UUID of its own, a later one never replacing an earlier one", () => {
      const k = twoKinds();
      k.unbound();
      expect(listed(tr)).toHaveLength(1);
      const first = structuredClone(listed(tr)[0]);

      k.noDeparture();
      expect(listed(tr)).toHaveLength(2);
      expect(listed(tr)[0]).toEqual(first);
      const second = structuredClone(listed(tr)[1]);

      k.unbound();
      const legs = listed(tr);
      expect(legs).toHaveLength(3);
      expect(legs[0]).toEqual(first);
      expect(legs[1]).toEqual(second);
      expect(legs.map((l) => [l.sim.title, l.origin])).toEqual([
        [OTHER.title, "KPVD"],
        [PLANE.title, null],
        [OTHER.title, "KPVD"],
      ]);
      for (const l of legs) expect(l.id).toMatch(UUID_V4);
      expect(new Set(legs.map((l) => l.id)).size).toBe(3);
    });

    // @spec LIVE-HOP-003
    it("keeps each leg's id with it in the checkpoint, so a restart lists the same legs in the same order", () => {
      const k = twoKinds();
      k.unbound();
      k.noDeparture();
      k.unbound();
      expect(listed(tr)).toHaveLength(3);
      const kept = listed(tr).map((l) => l.id);

      expect(readCheckpoint()!.pending.map((l: { id: string }) => l.id)).toEqual(kept);
      expect(listed(new Tracker()).map((l) => l.id)).toEqual(kept);
    });

    // @spec LIVE-HOP-003
    it("logs or discards one pending leg by its id and leaves the others listed as they were", () => {
      const k = twoKinds();
      k.unbound();
      k.noDeparture();
      k.unbound();
      expect(listed(tr)).toHaveLength(3);
      const [a, b, c] = structuredClone(listed(tr));

      tr.savePending(b.id, { origin: "KPVD" });
      expect(listed(tr)).toEqual([a, c]);

      tr.discardPending(a.id);
      expect(listed(tr)).toEqual([c]);
    });

    // @spec LIVE-HOP-003
    it("gives a leg kept after the others were discarded an id never used before", () => {
      const k = twoKinds();
      k.unbound();
      k.noDeparture();
      k.unbound();
      expect(listed(tr)).toHaveLength(3);
      const seen = listed(tr).map((l) => l.id);
      for (const id of seen) tr.discardPending(id);
      expect(listed(tr)).toEqual([]);

      k.unbound();
      expect(listed(tr)).toHaveLength(1);
      const id = listed(tr)[0].id;
      expect(id).toMatch(UUID_V4);
      expect(seen).not.toContain(id);
    });
  });

  describe("binding the sim aircraft with legs waiting", () => {
    // @spec LIVE-BIND-003
    it("sets the aircraft on every pending leg flown in the same sim title and livery that has none, and on no other", () => {
      const { p, fly } = pilotIn(tr, OTHER);
      flyCircuit(p); // OTHER, no aircraft
      flyCircuit(p); // OTHER, no aircraft
      fly({ ...OTHER, livery: "Red" });
      flyCircuit(p); // OTHER in another livery, no aircraft
      const cubA = fleetAircraft(OTHER, "Cub A", "Yellow");
      fly(OTHER); // the binding is looked up afresh for OTHER: Cub A
      circuitFromNowhere(p); // OTHER with an aircraft, kept for its unknown departure

      const legs = listed(tr);
      expect(legs).toHaveLength(4);
      const red = legs.find((l) => l.sim.livery === "Red")!;
      const withAircraft = legs.find((l) => l.origin === null)!;
      const same = legs.filter((l) => l !== red && l !== withAircraft);
      expect(red.aircraft_id).toBeNull();
      expect(withAircraft).toMatchObject({ sim: { title: OTHER.title, livery: OTHER.livery }, aircraft_id: cubA });
      expect(same.map((l) => [l.sim.title, l.sim.livery, l.aircraft_id])).toEqual([
        [OTHER.title, OTHER.livery, null],
        [OTHER.title, OTHER.livery, null],
      ]);
      expect(tr.status().sim).toMatchObject({ title: OTHER.title, livery: OTHER.livery });

      const cubB = fleetAircraft(OTHER, "Cub B", "Yellow");
      tr.bind(cubB);

      const aircraftOf = Object.fromEntries(listed(tr).map((l) => [l.id, l.aircraft_id]));
      expect(aircraftOf).toEqual({
        [same[0].id]: cubB,
        [same[1].id]: cubB,
        [red.id]: null,
        [withAircraft.id]: cubA,
      });
    });
  });

  describe("a disconnect in flight", () => {
    // @spec LIVE-LEG-008, LIVE-API-014
    it.each([
      ["the connection ends", undefined],
      ["MSFS quits", { quit: true }],
    ])("keeps the airborne leg as a pending leg ending at the last sample, with the current briefing, and saves it at once when %s", (_, opts) => {
      const planeId = fleetAircraft();
      const p = pilot(tr);
      const briefing = addBriefing();
      tr.setBriefing(briefing);
      takeOff(p);
      p.air(70);
      const flying = tr.status();
      expect(flying.leg?.origin).toBe("KPVD");
      const kept: PendingLegStatus[] = [];
      tr.on("pending", (l: PendingLegStatus) => kept.push(l));

      tr.setConnected(false, null, opts);

      const st = tr.status();
      expect(st.leg).toBeNull();
      expect(hopCount()).toBe(0);
      expect(st.pending).toHaveLength(1);
      expect(st.pending[0]).toMatchObject({
        aircraft_id: planeId,
        origin: "KPVD",
        dest: null,
        departed_at: flying.leg!.departed_at,
        arrived_at: flying.position!.t,
        briefing_id: briefing.id,
        reason: "the sim disconnected in flight",
      });
      // The plan went with the leg: it is no longer the current one.
      expect(st.briefing).toBeNull();
      expect(kept).toEqual([st.pending[0]]);

      // A disconnect is no sample, so only an immediate save puts this in the checkpoint.
      const cp = readCheckpoint()!;
      expect(cp.leg).toBeNull();
      expect(cp.pending.map((l: { id: string }) => l.id)).toEqual([st.pending[0].id]);
    });
  });

  describe("a leg restored in the air at server start", () => {
    /**
     * A bound PLANE leg from KPVD in the air, then a server restart: a new tracker restored from the
     * checkpoint, its sim connected afresh, and the same pilot (clock and position) feeding it.
     */
    function restartInFlight() {
      const planeId = fleetAircraft();
      const p = pilot(tr);
      const briefing = addBriefing();
      tr.setBriefing(briefing);
      takeOff(p);
      p.air(70);
      const flown = tr.status().leg!;
      expect(flown.origin).toBe("KPVD");

      const after = new Tracker();
      after.setConnected(true, "Fake MSFS");
      p.use(after);
      const restored = after.status();
      expect(restored.phase).toBe("airborne");
      expect(restored.leg).toMatchObject({ origin: "KPVD", departed_at: flown.departed_at });
      const messages: (string | null)[] = [];
      after.on("status", (s) => messages.push(s.message));
      const kept: PendingLegStatus[] = [];
      after.on("pending", (l: PendingLegStatus) => kept.push(l));
      return { p, after, planeId, briefingId: briefing.id, departedAt: flown.departed_at, lastT: restored.position!.t, messages, kept };
    }
    type Restarted = ReturnType<typeof restartInFlight>;

    /**
     * The restored leg kept as a pending leg ending at its restored last sample, with the briefing
     * that was current, and sent as one `pending` event; nothing discarded or logged.
     */
    function expectKeptAsPending(r: Restarted) {
      const st = r.after.status();
      expect(st.pending).toHaveLength(1);
      expect(st.pending[0]).toMatchObject({
        sim: { title: PLANE.title, livery: PLANE.livery },
        aircraft_id: r.planeId,
        origin: "KPVD",
        dest: null,
        departed_at: r.departedAt,
        arrived_at: r.lastT,
        landings: [],
        briefing_id: r.briefingId,
        reason: "MSFS Career Map stopped in flight and the sim did not resume it",
      });
      expect(st.briefing).toBeNull();
      expect(r.kept).toEqual([st.pending[0]]);
      expect(hopCount()).toBe(0);
      expect(r.messages.join("\n")).not.toMatch(/Discarded/);
    }

    // @spec LIVE-LEG-016
    it.each([
      ["straight away", (p: Pilot) => p.air(1)],
      ["10 min later and 100 nm on", (p: Pilot) => {
        p.wait(600);
        p.jump(100);
        p.air(1);
      }],
      ["after a sample at the sim's menu position, which the tracker ignores", (p: Pilot) => {
        p.feed({ lat: 0.01, lon: -0.02, alt_ft: 30000, on_ground: false, gs_kts: 0 });
        p.air(1);
      }],
    ])("continues the leg when the first sample shows the same aircraft in the air within reach (%s)", (_, resume) => {
      const r = restartInFlight();
      resume(r.p);
      const st = r.after.status();
      expect(st.phase).toBe("airborne");
      expect(st.leg).toMatchObject({ origin: "KPVD", departed_at: r.departedAt });
      expect(st.pending).toEqual([]);
      expect(r.messages.join("\n")).not.toMatch(/Discarded/);
    });

    // @spec LIVE-LEG-016, LIVE-API-014
    it.each([
      ["a new flight is loaded before the first sample", (r: Restarted) => {
        r.after.flightLoaded("x.FLT");
        r.p.air(1);
      }],
      ["the first sample shows another sim aircraft", (r: Restarted) => {
        r.p.feed({ ...OTHER, on_ground: false, alt_ft: 1500, gs_kts: 100 });
      }],
      ["the first sample is beyond reach of the last one", (r: Restarted) => {
        r.p.jump(200);
        r.p.air(1);
      }],
    ])("keeps the leg as pending at its last sample and starts a leg in the air afresh when %s", (_, act) => {
      const r = restartInFlight();
      act(r);
      expectKeptAsPending(r);
      const st = r.after.status();
      expect(st.phase).toBe("airborne");
      expect(st.leg).toMatchObject({ origin: null, landings: [] });
      expect(st.leg!.departed_at).not.toBe(r.departedAt);
    });

    // @spec LIVE-LEG-016, LIVE-API-014
    it("keeps the leg as pending at its last sample when the first sample is on the ground, and logs no hop as the aircraft stands", () => {
      const r = restartInFlight();
      r.p.ground(1);
      expectKeptAsPending(r);
      const st = r.after.status();
      expect(st.phase).toBe("ground");
      expect(st.leg).toBeNull();

      r.p.ground(40);
      expect(hopCount()).toBe(0);
      expect(listed(r.after)).toHaveLength(1);
    });

    // @spec LIVE-LEG-016, LIVE-HOP-007, LIVE-API-014
    it.each([
      ["the connection ends", undefined],
      ["MSFS quits", { quit: true }],
    ])("keeps the leg as pending, ended in the air, when the sim's connection ends before the first sample (%s), and starts afresh on the next connection", (_, opts) => {
      const r = restartInFlight();

      r.after.setConnected(false, null, opts);

      expectKeptAsPending(r);
      expect(r.after.status().pending[0].ended_in_air).toBe(true);

      r.after.setConnected(true, "Fake MSFS");
      r.p.home();
      r.p.ground(3);
      const st = r.after.status();
      expect(st.phase).toBe("ground");
      expect(st.leg).toBeNull();
      expect(st.pending).toHaveLength(1);
      expect(hopCount()).toBe(0);
    });
  });
});
