/**
 * A landed leg when a new flight is loaded or the position jumps (LIVE-LEG-011): closed at the last
 * sample before the event, logged as a hop when it can be and otherwise kept as pending with
 * `ended_in_air: false`, never discarded. An airborne leg is still discarded by either (LIVE-LEG-010).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SimSample } from "../../src/server/simconnect.ts";
import { Tracker, type HopEvent, type Landing, type PendingLegStatus, type TrackPoint } from "../../src/server/tracker.ts";
import { PLANE, fleetAircraft, pilot, takeOff, type Pilot } from "./pilot.ts";
import { hopCount, hopRows, resetLogbook } from "./state.ts";

const UNBOUND = "no fleet aircraft is bound to this sim aircraft";

/** The track point a sample becomes, in the logbook's track format. */
const pointOf = (s: SimSample): TrackPoint => [
  Number(s.lat.toFixed(5)),
  Number(s.lon.toFixed(5)),
  Math.round(s.alt_ft),
  Math.round(s.t / 1000),
  Math.round(s.gs_kts),
  Math.round(s.vs_fpm),
  Math.round(s.ias_kts),
  Math.round(s.fuel_lb),
];

/**
 * Take off from KPVD, fly 80 s and touch down back there, rolling at 30 kt without stopping:
 * `takeOff(p); p.air(80); p.home(); p.ground(5, 30)`, the last of those samples returned.
 */
function landWithoutStopping(p: Pilot): SimSample {
  takeOff(p);
  p.air(80);
  p.home();
  p.ground(4, 30);
  return p.feed({ on_ground: true, gs_kts: 30, alt_ft: 60 });
}

/** The tracker's messages and hops from now on. */
function watch(t: Tracker) {
  const messages: (string | null)[] = [];
  const hops: HopEvent[] = [];
  const pending: PendingLegStatus[] = [];
  t.on("status", (s) => messages.push(s.message));
  t.on("hop", (h: HopEvent) => hops.push(h));
  t.on("pending", (l: PendingLegStatus) => pending.push(l));
  return { messages, hops, pending };
}

type Watched = ReturnType<typeof watch>;

/** The landed leg logged as a hop KPVD → KPVD, arriving at the touchdown and ending at `last`. */
function expectLoggedAt(t: Tracker, w: Watched, touchdownAt: string, last: SimSample): TrackPoint[] {
  expect(hopRows()).toHaveLength(1);
  expect(hopRows()[0]).toMatchObject({ origin: "KPVD", dest: "KPVD", arrived_at: touchdownAt });
  expect(w.hops).toHaveLength(1);
  const track = JSON.parse(w.hops[0].hop.track!) as TrackPoint[];
  expect(track.at(-1)).toEqual(pointOf(last));
  expect(w.messages.join("\n")).not.toMatch(/Discarded/);
  // The hop's own message (LIVE-HOP-006); a note the tracker writes after it is its own business.
  expect(w.hops[0].message).toMatch(/^Logged KPVD → KPVD/);
  expect(t.status().phase).toBe("ground");
  expect(t.status().leg).toBeNull();
  expect(t.status().pending).toEqual([]);
  return track;
}

describe("interruptions of a leg", () => {
  let tr: Tracker;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.parse("2026-10-12T11:59:00Z"));
    resetLogbook();
    tr = new Tracker();
    tr.setConnected(true, "Fake MSFS");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("while landed", () => {
    // @spec LIVE-LEG-011
    it("closes a bound landed leg at the last sample when a new flight is loaded, logging the hop", () => {
      fleetAircraft();
      const p = pilot(tr);
      const last = landWithoutStopping(p);
      expect(tr.status().phase).toBe("landed");
      const touchdownAt = tr.status().leg!.touchdown_at!;
      const w = watch(tr);

      tr.flightLoaded("C:\\flights\\next.FLT");

      expectLoggedAt(tr, w, touchdownAt, last);
    });

    // @spec LIVE-LEG-011
    it("closes a bound landed leg at the last sample before a jump of 200 nm, logging the hop without the jumping sample", () => {
      fleetAircraft();
      const p = pilot(tr);
      const last = landWithoutStopping(p);
      expect(tr.status().phase).toBe("landed");
      const touchdownAt = tr.status().leg!.touchdown_at!;
      const w = watch(tr);

      p.jump(200);
      const jumping = p.feed({ on_ground: true, gs_kts: 0, alt_ft: 60 });

      const track = expectLoggedAt(tr, w, touchdownAt, last);
      expect(track.some((pt) => pt[3] === Math.round(jumping.t / 1000))).toBe(false);
      expect(track.some((pt) => pt[0] === Number(jumping.lat.toFixed(5)))).toBe(false);
    });

    // @spec LIVE-LEG-011, LIVE-LAND-002
    it("logs the frame-accurate touchdown that arrives on the jumping sample, placed where the aircraft last was", () => {
      fleetAircraft();
      const p = pilot(tr);
      const last = landWithoutStopping(p);
      const touchdownAt = tr.status().leg!.touchdown_at!;
      expect(tr.status().leg!.landings).toMatchObject([{ source: "samples" }]);
      const w = watch(tr);

      // The per-frame watcher's touchdown comes with the next 1 Hz sample, which is past the jump bound.
      p.jump(200);
      p.feed({
        on_ground: true,
        gs_kts: 0,
        alt_ft: 60,
        touchdown: { t: Date.parse(touchdownAt), fpm: 420, g: 2.4, ias_kts: 61, sim_fpm: 410, pitch_deg: 2.5, bank_deg: 0.5 },
      });

      expectLoggedAt(tr, w, touchdownAt, last);
      const landings = JSON.parse(w.hops[0].hop.landings!) as Landing[];
      expect(landings).toEqual([
        {
          t: touchdownAt,
          fpm: 420,
          g: 2.4,
          ias_kts: 61,
          sim_fpm: 410,
          pitch_deg: 2.5,
          bank_deg: 0.5,
          lat: Number(last.lat.toFixed(5)),
          lon: Number(last.lon.toFixed(5)),
          rating: "hard",
          source: "frames",
        },
      ]);
      expect(w.hops[0].message).toMatch(/, 420 fpm hard$/);
    });

    // @spec LIVE-LEG-011, LIVE-HOP-007
    it.each([
      ["a new flight is loaded", (t: Tracker) => t.flightLoaded("C:\\flights\\next.FLT")],
      ["the position jumps 200 nm", (_t: Tracker, p: Pilot) => {
        p.jump(200);
        p.feed({ on_ground: true, gs_kts: 0, alt_ft: 60 });
      }],
    ])("keeps an unbound landed leg as pending, ended on the ground, when %s", (_, act) => {
      const p = pilot(tr);
      landWithoutStopping(p);
      const touchdownAt = tr.status().leg!.touchdown_at!;
      const w = watch(tr);

      act(tr, p);

      const st = tr.status();
      expect(st.leg).toBeNull();
      expect(st.pending).toHaveLength(1);
      expect(st.pending[0]).toMatchObject({
        sim: { title: PLANE.title, livery: PLANE.livery },
        origin: "KPVD",
        dest: "KPVD",
        arrived_at: touchdownAt,
        reason: UNBOUND,
        ended_in_air: false,
      });
      expect(w.pending).toEqual([st.pending[0]]);
      expect(hopCount()).toBe(0);
      expect(w.messages.join("\n")).not.toMatch(/Discarded/);
    });

    // @spec LIVE-LEG-011
    it("closes a landed leg restored at server start when a new flight is loaded, logging the hop", () => {
      fleetAircraft();
      const p = pilot(tr);
      const last = landWithoutStopping(p);
      const touchdownAt = tr.status().leg!.touchdown_at!;
      tr.saveNow();

      const after = new Tracker();
      after.setConnected(true, "Fake MSFS");
      expect(after.status()).toMatchObject({ phase: "landed", leg: { origin: "KPVD", touchdown_at: touchdownAt } });
      const w = watch(after);

      after.flightLoaded("C:\\flights\\next.FLT");

      expectLoggedAt(after, w, touchdownAt, last);
    });
  });

  describe("while airborne", () => {
    // @spec LIVE-LEG-010
    it("still discards a bound airborne leg when a new flight is loaded", () => {
      fleetAircraft();
      const p = pilot(tr);
      takeOff(p);
      p.air(30);
      expect(tr.status().phase).toBe("airborne");
      const w = watch(tr);

      tr.flightLoaded("C:\\flights\\next.FLT");

      expect(tr.status().leg).toBeNull();
      expect(tr.status().pending).toEqual([]);
      expect(hopCount()).toBe(0);
      expect(w.messages.join("\n")).toMatch(/Discarded/);
    });

    // @spec LIVE-LEG-010
    it("still discards a bound airborne leg when the position jumps 200 nm", () => {
      fleetAircraft();
      const p = pilot(tr);
      takeOff(p);
      p.air(30);
      const departedAt = tr.status().leg!.departed_at;
      const w = watch(tr);

      p.jump(200);
      p.air(1);

      const st = tr.status();
      expect(st.pending).toEqual([]);
      expect(hopCount()).toBe(0);
      expect(w.messages.join("\n")).toMatch(/Discarded/);
      // The jumping sample starts tracking afresh, in the air.
      expect(st.leg).toMatchObject({ origin: null });
      expect(st.leg!.departed_at).not.toBe(departedAt);
    });
  });
});
