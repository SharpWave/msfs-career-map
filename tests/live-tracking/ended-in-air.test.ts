/**
 * Whether a pending leg ended in the air (LIVE-HOP-007): true for a leg kept while airborne, false
 * for one closed after landing, carried with the leg in the status, the `pending` event,
 * `pendingLeg(id)` (and so `GET /api/tracker/pending/:id`) and the checkpoint. A leg saved without
 * the mark reads as ended in the air only by its reason (LIVE-SAVE-002).
 */
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Tracker, tracker, type PendingLegStatus } from "../../src/server/tracker.ts";
import { openEvents } from "../support/event-stream.ts";
import { startTestServer, type TestServer } from "../support/test-server.ts";
import { NOWHERE, PLANE, fleetAircraft, flyCircuit, land, pilot, takeOff, type Pilot } from "./pilot.ts";
import { readCheckpoint, resetLogbook, writeCheckpoint } from "./state.ts";

const DISCONNECTED = "the sim disconnected in flight";
const NOT_RESUMED = "MSFS Career Map stopped in flight and the sim did not resume it";
const UNBOUND = "no fleet aircraft is bound to this sim aircraft";

/**
 * One way a leg comes to be kept as pending. It flies `tr` (a fresh tracker, connected) and returns
 * the tracker holding the pending leg; `listen` collects the `pending` events of a tracker.
 */
type Way = (tr: Tracker, listen: (t: Tracker) => Tracker) => Tracker;

/** Airborne from KPVD, then a server restart: a new tracker restored from the checkpoint, its sim connected afresh. */
function restarted(tr: Tracker, listen: (t: Tracker) => Tracker): { p: Pilot; after: Tracker } {
  const p = pilot(tr);
  takeOff(p);
  p.air(70);
  const after = listen(new Tracker());
  after.setConnected(true, "Fake MSFS");
  expect(after.status().phase).toBe("airborne");
  p.use(after);
  return { p, after };
}

const WAYS: [string, boolean, Way][] = [
  ["an unbound circuit closed after landing", false, (tr, listen) => {
    listen(tr);
    flyCircuit(pilot(tr));
    return tr;
  }],
  ["a bound circuit with no departure airport, closed after landing", false, (tr, listen) => {
    fleetAircraft();
    listen(tr);
    const p = pilot(tr);
    p.moveTo(NOWHERE);
    takeOff(p);
    p.air(80);
    land(p);
    return tr;
  }],
  ["a landed leg closed when the sim's connection ends", false, (tr, listen) => {
    listen(tr);
    const p = pilot(tr);
    takeOff(p);
    p.air(80);
    p.home();
    p.ground(5, 30);
    tr.setConnected(false);
    return tr;
  }],
  ["a disconnect in flight", true, (tr, listen) => {
    listen(tr);
    const p = pilot(tr);
    takeOff(p);
    p.air(70);
    tr.setConnected(false);
    return tr;
  }],
  ["MSFS quitting in flight", true, (tr, listen) => {
    listen(tr);
    const p = pilot(tr);
    takeOff(p);
    p.air(70);
    tr.setConnected(false, null, { quit: true });
    return tr;
  }],
  ["a restored leg whose first sample is on the ground", true, (tr, listen) => {
    const { p, after } = restarted(tr, listen);
    p.ground(1);
    return after;
  }],
  ["a restored leg when a new flight is loaded before the first sample", true, (tr, listen) => {
    const { after } = restarted(tr, listen);
    after.flightLoaded("x.FLT");
    return after;
  }],
];

/** A pending leg as a checkpoint holds it, its reason and mark as given (the mark left out when undefined). */
function savedLeg(reason: string, mark?: boolean | null): Record<string, any> {
  const leg: Record<string, any> = {
    id: randomUUID(),
    sim: { ...PLANE },
    aircraft_id: null,
    origin: "KPVD",
    dest: null,
    departed_at: "2026-10-12T11:00:00.000Z",
    arrived_at: "2026-10-12T11:30:00.000Z",
    duration_min: 30,
    track: [[41.7246, -71.4282, 60, 1760266800, 0, 0, 0, 300]],
    landings: [],
    stats: {
      fuel_start_lb: null, fuel_end_lb: null, fuel_used_lb: null, weight_start_lb: null,
      weight_end_lb: null, max_alt_ft: null, max_gs_kts: null, flown_nm: null,
    },
    briefing_id: null,
    reason,
  };
  if (mark !== undefined) leg.ended_in_air = mark;
  return leg;
}

function groundCheckpoint(pending: unknown): Record<string, any> {
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

describe("ended in the air", () => {
  describe("on trackers", () => {
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

    // @spec LIVE-HOP-007
    it.each(WAYS)("marks %s with ended_in_air %s in the status, the pending event, pendingLeg and the checkpoint", (_, mark, way) => {
      const events: PendingLegStatus[] = [];
      const holder = way(tr, (t) => {
        t.on("pending", (l: PendingLegStatus) => events.push(l));
        return t;
      });

      const st = holder.status();
      expect(st.pending).toHaveLength(1);
      const [leg] = st.pending;
      expect(leg.ended_in_air).toBe(mark);
      expect(events).toHaveLength(1);
      expect(events[0].ended_in_air).toBe(mark);
      expect(events).toEqual([leg]);
      expect(holder.pendingLeg(leg.id)!.ended_in_air).toBe(mark);
      expect(readCheckpoint()!.pending.map((l: { id: string; ended_in_air: unknown }) => [l.id, l.ended_in_air])).toEqual([[leg.id, mark]]);
    });

    describe("a leg saved without the mark", () => {
      // @spec LIVE-SAVE-002
      it("reads as ended in the air only by its reason, keeps a mark that is present, and saves each mark with the next save", () => {
        const legs = [
          savedLeg(DISCONNECTED),
          savedLeg(NOT_RESUMED),
          savedLeg(UNBOUND),
          savedLeg(DISCONNECTED, null),
          savedLeg(DISCONNECTED, false),
          savedLeg(UNBOUND, true),
        ];
        const marks = [true, true, false, true, false, true];
        writeCheckpoint(groundCheckpoint(legs));

        const restored = new Tracker();
        const st = restored.status();
        expect(st.pending.map((l) => [l.id, l.ended_in_air])).toEqual(legs.map((l, i) => [l.id, marks[i]]));
        for (const [i, l] of legs.entries()) expect(restored.pendingLeg(l.id)!.ended_in_air).toBe(marks[i]);

        restored.saveNow();
        expect(readCheckpoint()!.pending.map((l: { id: string; ended_in_air: unknown }) => [l.id, l.ended_in_air])).toEqual(
          legs.map((l, i) => [l.id, marks[i]]),
        );
      });

      // @spec LIVE-SAVE-002
      it.each([
        [DISCONNECTED, true],
        ["no airport within 5 nm of where it stopped", false],
      ])("reads an older version's single pending leg with the reason %j as ended_in_air %s", (reason, mark) => {
        const { id: _id, ...single } = savedLeg(reason);
        writeCheckpoint(groundCheckpoint(single));

        const restored = new Tracker();
        const [leg] = restored.status().pending;
        expect(leg.ended_in_air).toBe(mark);
        expect(restored.pendingLeg(leg.id)!.ended_in_air).toBe(mark);
        restored.saveNow();
        expect(readCheckpoint()!.pending.map((l: { ended_in_air: unknown }) => l.ended_in_air)).toEqual([mark]);
      });
    });
  });

  describe("on a test server", () => {
    let server: TestServer;
    let p: Pilot;

    beforeAll(async () => {
      server = await startTestServer();
      vi.useFakeTimers({ toFake: ["Date"] });
      resetLogbook();
      p = pilot(tracker);
      tracker.setConnected(true, "Fake MSFS");
    });
    afterAll(async () => {
      await server.close();
      vi.useRealTimers();
    });

    // @spec LIVE-HOP-007
    it("lists the mark in GET /api/tracker, carries it in GET /api/tracker/pending/:id and sends it on the pending event", async () => {
      const events = await openEvents(server.base);
      try {
        flyCircuit(p); // unbound: closed after landing
        const landed = (await events.until("pending")) as PendingLegStatus;
        takeOff(p);
        p.air(70);
        tracker.setConnected(false); // in flight
        const inAir = (await events.until("pending")) as PendingLegStatus;
        tracker.setConnected(true, "Fake MSFS");

        expect(landed).toMatchObject({ reason: UNBOUND, ended_in_air: false });
        expect(inAir).toMatchObject({ reason: DISCONNECTED, ended_in_air: true });

        const res = await fetch(`${server.base}/api/tracker`);
        expect(res.status).toBe(200);
        const st = await res.json();
        expect(st.pending.map((l: { id: string; ended_in_air: unknown }) => [l.id, l.ended_in_air])).toEqual([
          [landed.id, false],
          [inAir.id, true],
        ]);

        for (const [leg, mark] of [[landed, false], [inAir, true]] as const) {
          const one = await fetch(`${server.base}/api/tracker/pending/${leg.id}`);
          expect(one.status).toBe(200);
          const full = await one.json();
          expect(full.id).toBe(leg.id);
          expect(full.ended_in_air).toBe(mark);
        }
      } finally {
        events.close();
      }
    });
  });
});
