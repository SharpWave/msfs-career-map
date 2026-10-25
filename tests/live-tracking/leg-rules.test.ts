/**
 * The tracker's remaining leg rules: a leg under a minute of flight time dropped, its briefing left
 * for the next leg (LIVE-LEG-013); time the sim is paused counting neither toward the 5 s takeoff
 * confirmation and the 30 s stop (LIVE-LEG-014) nor toward flight time (LIVE-REC-003); the bound
 * aircraft's parked airport named as the departure on a near-tie (LIVE-NAME-002); and the leg's
 * statistics so far in the status (LIVE-API-006).
 *
 * Samples come one a second from the pilot (pilot.ts), starting at KPVD: 3 on the ground, then the
 * first airborne sample is the takeoff time, so a leg's flight time is easy to count in samples.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../src/server/db.ts";
import { distanceNm } from "../../src/server/airports.ts";
import { Tracker } from "../../src/server/tracker.ts";
import { KPVD, OTHER, fleetAircraft, land, pilot, takeOff, type Pilot } from "./pilot.ts";
import { addBriefing, briefingHopId, hopCount, hopRows, resetLogbook } from "./state.ts";

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

/** Pause the sim for `sec` seconds: what the pilot flies meanwhile is ignored, as the link sends it. */
function pause(p: Pilot, sec: number, flying: (p: Pilot) => void = () => {}) {
  tr.setPaused(true);
  flying(p);
  p.wait(sec);
  tr.setPaused(false);
}

describe("a leg under a minute (LIVE-LEG-013)", () => {
  beforeEach(() => {
    fleetAircraft();
  });

  // @spec LIVE-LEG-013
  it("drops a leg of 50 s of flight time without logging it, and leaves the briefing for the next leg", () => {
    const b = addBriefing();
    tr.setBriefing(b);
    const p = pilot(tr);
    takeOff(p);
    p.air(40); // touchdown 50 s after the first airborne sample
    land(p);

    expect(hopCount()).toBe(0);
    const st = tr.status();
    expect(st.pending).toEqual([]);
    expect(st.leg).toBeNull();
    expect(st.phase).toBe("ground");
    expect(st.message).toBe("Dropped a leg under a minute long");
    expect(st.briefing?.id).toBe(b.id);
    expect(briefingHopId(b.id)).toBeNull();
  });

  // @spec LIVE-LEG-013
  it("drops a leg of 59 s of flight time, which rounds to a minute", () => {
    const p = pilot(tr);
    takeOff(p);
    p.air(49); // touchdown 59 s after the first airborne sample
    land(p);
    expect(hopCount()).toBe(0);
    expect(tr.status().pending).toEqual([]);
  });

  // @spec LIVE-LEG-013, LIVE-REC-003
  it("logs a leg of 61 s of flight time as one minute, using the briefing", () => {
    const b = addBriefing();
    tr.setBriefing(b);
    const p = pilot(tr);
    takeOff(p);
    p.air(51); // touchdown 61 s after the first airborne sample
    land(p);
    const [hop] = hopRows();
    expect(hop).toMatchObject({ origin: "KPVD", dest: "KPVD", duration_min: 1, briefing_id: b.id });
    expect(tr.status().briefing).toBeNull();
  });

  // @spec LIVE-LEG-013, LIVE-REC-003
  it("drops a leg whose flight time is under a minute once the time paused is left out, though takeoff to touchdown took longer", () => {
    const b = addBriefing();
    tr.setBriefing(b);
    const p = pilot(tr);
    takeOff(p);
    p.air(20);
    pause(p, 120);
    p.air(15);
    land(p);
    expect(hopCount()).toBe(0);
    expect(tr.status().pending).toEqual([]);
    expect(tr.status().briefing?.id).toBe(b.id);
  });
});

describe("time the sim is paused (LIVE-LEG-014, LIVE-REC-003)", () => {
  // @spec LIVE-LEG-014
  it("does not count a pause toward the 5 s takeoff confirmation, and keeps the first airborne sample as the takeoff time", () => {
    const p = pilot(tr);
    p.ground(3);
    const firstAirborne = p.t;
    p.air(3); // 2 s off the ground so far
    pause(p, 60, (q) => q.air(4));
    p.air(1); // the gap across the pause counts for nothing
    expect(tr.status().phase).toBe("ground");
    expect(tr.status().leg).toBeNull();
    p.air(4);
    const st = tr.status();
    expect(st.phase).toBe("airborne");
    expect(st.leg?.departed_at).toBe(new Date(firstAirborne).toISOString());
  });

  // @spec LIVE-LEG-014
  it("does not count a pause toward the 30 s stop", () => {
    fleetAircraft();
    const p = pilot(tr);
    takeOff(p);
    p.air(110);
    p.home();
    p.ground(5, 30);
    p.ground(20); // 19 s stopped so far
    pause(p, 60);
    p.ground(1);
    expect(tr.status().phase).toBe("landed");
    p.ground(9); // 28 s stopped, the pause left out
    expect(tr.status().phase).toBe("landed");
    expect(hopCount()).toBe(0);
    p.ground(5);
    expect(tr.status().phase).toBe("ground");
    expect(hopCount()).toBe(1);
  });

  // @spec LIVE-LEG-014
  it("still counts a gap between samples with no pause in it, so a stop running before it completes on the first sample after it", () => {
    fleetAircraft();
    const p = pilot(tr);
    takeOff(p);
    p.air(110);
    p.home();
    p.ground(5, 30);
    p.ground(20);
    p.wait(60); // no pause: the PC asleep, or a sim not reporting
    p.ground(1);
    expect(tr.status().phase).toBe("ground");
    expect(hopCount()).toBe(1);
  });

  // @spec LIVE-REC-003
  it("records the flight time as the whole minutes from takeoff to the last touchdown less a pause in flight, the real-world times left as they were", () => {
    fleetAircraft();
    const p = pilot(tr);
    p.ground(3);
    const departed = p.t;
    p.air(10);
    p.air(70);
    pause(p, 600, (q) => q.air(5));
    p.air(70);
    p.home();
    const touchdown = p.t;
    p.ground(5, 30);
    p.ground(35);

    const [hop] = hopRows();
    // 755 s from takeoff to touchdown, 606 s of them across the pause: 149 s, two minutes.
    expect(hop).toMatchObject({
      origin: "KPVD",
      dest: "KPVD",
      duration_min: 2,
      departed_at: new Date(departed).toISOString(),
      arrived_at: new Date(touchdown).toISOString(),
    });
  });

  // @spec LIVE-REC-003
  it("leaves out pauses on the ground before a touch-and-go too, and every pause in the flight, but not one after the last touchdown", () => {
    fleetAircraft();
    const p = pilot(tr);
    takeOff(p);
    p.air(50);
    pause(p, 300, (q) => q.air(3));
    p.air(20);
    p.home();
    p.ground(5, 40); // touch...
    pause(p, 200);
    p.air(25); // ...and go
    pause(p, 400, (q) => q.air(2));
    p.air(20);
    p.home();
    p.ground(5, 30); // the last touchdown
    pause(p, 900);
    p.ground(35);

    const [hop] = hopRows();
    // Flown: 10 + 50 + 20 + 5 + 25 + 20 s = 130 s, about 2 min; the pauses would add 30 min.
    expect(hop.duration_min).toBe(2);
  });

  // @spec LIVE-REC-003
  it("leaves the pauses out of a leg kept pending when the sim disconnects in flight", () => {
    const p = pilot(tr);
    p.ground(3);
    p.air(10);
    p.air(60);
    pause(p, 300);
    p.air(60);
    tr.setConnected(false);
    const [leg] = tr.status().pending;
    expect(leg.reason).toBe("the sim disconnected in flight");
    // 429 s from takeoff to the last sample, 301 s of them across the pause.
    expect(leg.duration_min).toBe(2);
  });

  // @spec LIVE-REC-003, LIVE-LEG-014
  it("keeps the time paused so far with a leg in progress across a server restart", () => {
    fleetAircraft();
    const p = pilot(tr);
    takeOff(p);
    p.air(60);
    pause(p, 600, (q) => q.air(2));
    p.air(10);
    tr.saveNow();

    const after = new Tracker();
    after.setConnected(true, "Fake MSFS");
    p.use(after);
    p.air(50);
    p.home();
    p.ground(5, 30);
    p.ground(35);

    const [hop] = hopRows();
    // Flown: 10 + 60 + 10 + 50 s = 130 s; the pause's 603 s left out.
    expect(hop.duration_min).toBe(2);
  });
});

describe("the parked airport on a near-tie at takeoff (LIVE-NAME-002)", () => {
  // KPVD lies about 0.12 nm from where the pilot stands; each of these is a large airport, so its
  // rank is its distance alone: XPRK 0.9 nm north (within 1 nm of KPVD's rank), XFAR 1.8 nm north.
  const XPRK = { ident: "XPRK", lat: KPVD.lat + 0.015 };
  const XFAR = { ident: "XFAR", lat: KPVD.lat + 0.03 };
  const insertAirport = db.prepare(`INSERT INTO airports (ident, type, name, lat, lon) VALUES (?, 'large_airport', ?, ?, ?)`);
  const parkAt = (aircraftId: number, ident: string, seq = 1) =>
    db.prepare(`INSERT INTO hops (aircraft_id, seq, origin, dest, notes) VALUES (?, ?, 'KBOS', ?, '')`).run(aircraftId, seq, ident);

  beforeEach(() => {
    db.prepare(`DELETE FROM airports WHERE ident IN ('XPRK', 'XFAR')`).run();
    insertAirport.run(XPRK.ident, "Parked Test Field", XPRK.lat, KPVD.lon);
    insertAirport.run(XFAR.ident, "Far Test Field", XFAR.lat, KPVD.lon);
  });
  afterEach(() => {
    db.prepare(`DELETE FROM airports WHERE ident IN ('XPRK', 'XFAR')`).run();
  });

  // @spec LIVE-NAME-002
  it("names the bound aircraft's parked airport as the departure when it ranks within 1 nm of the nearest", () => {
    expect(distanceNm(KPVD.lat, KPVD.lon, XPRK.lat, KPVD.lon)).toBeLessThan(1);
    const id = fleetAircraft();
    parkAt(id, "XPRK");
    const p = pilot(tr);
    takeOff(p);
    expect(tr.status().leg?.origin).toBe("XPRK");
  });

  // @spec LIVE-NAME-002
  it("parks the aircraft at its highest-sequence hop's destination", () => {
    const id = fleetAircraft();
    parkAt(id, "XPRK", 2);
    parkAt(id, "KBOS", 1);
    const p = pilot(tr);
    takeOff(p);
    expect(tr.status().leg?.origin).toBe("XPRK");
  });

  // @spec LIVE-NAME-002, LIVE-NAME-001
  it("names the nearest airport when the parked airport ranks more than 1 nm behind it", () => {
    const id = fleetAircraft();
    parkAt(id, "XFAR");
    const p = pilot(tr);
    takeOff(p);
    expect(tr.status().leg?.origin).toBe("KPVD");
  });

  // @spec LIVE-NAME-002, LIVE-NAME-001
  it("names the nearest airport when the aircraft is parked more than 5 nm away", () => {
    const id = fleetAircraft();
    parkAt(id, "KOQU"); // Quonset, about 7.7 nm south
    const p = pilot(tr);
    takeOff(p);
    expect(tr.status().leg?.origin).toBe("KPVD");
  });

  // @spec LIVE-NAME-002, LIVE-NAME-001
  it("names the nearest airport for an aircraft with no hops, and for a sim aircraft bound to no fleet aircraft", () => {
    fleetAircraft();
    const p = pilot(tr);
    takeOff(p);
    expect(tr.status().leg?.origin).toBe("KPVD");

    resetLogbook();
    const parked = fleetAircraft(OTHER, "Test Cub", "Yellow");
    parkAt(parked, "XPRK");
    db.prepare(`UPDATE aircraft SET sim_title = NULL, sim_livery = NULL`).run();
    const unbound = new Tracker();
    unbound.setConnected(true, "Fake MSFS");
    const q = pilot(unbound, OTHER);
    takeOff(q);
    expect(unbound.status().aircraft_id).toBeNull();
    expect(unbound.status().leg?.origin).toBe("KPVD");
  });
});

describe("the leg's statistics so far (LIVE-API-006)", () => {
  // @spec LIVE-API-006
  it("carries the fuel and weight at takeoff, the fuel used, the highest altitude and ground speed and the distance flown so far", () => {
    const p = pilot(tr);
    p.ground(3);
    for (let i = 0; i < 40; i++) {
      p.feed({ on_ground: false, gs_kts: 100 + i, ias_kts: 100, alt_ft: 1000 + i * 25, fuel_lb: 300 - i, weight_lb: 2400 - i });
    }
    const st = tr.status();
    expect(st.phase).toBe("airborne");
    const track = tr.track();
    let flown = 0;
    for (let i = 1; i < track.length; i++) flown += distanceNm(track[i - 1][0], track[i - 1][1], track[i][0], track[i][1]);
    expect(st.leg?.stats).toMatchObject({
      fuel_start_lb: 300,
      weight_start_lb: 2400,
      fuel_used_lb: 39,
      max_alt_ft: 1000 + 39 * 25,
      max_gs_kts: 139,
      flown_nm: Number(flown.toFixed(1)),
    });
    expect(st.leg!.stats.flown_nm).toBeGreaterThan(0);
  });

  // @spec LIVE-API-006
  it("sends the statistics with each status, growing as the leg goes on, and none once no leg is in progress", () => {
    fleetAircraft();
    const p = pilot(tr);
    const sent: { leg: { stats?: { flown_nm: number | null } } | null }[] = [];
    tr.on("status", (s) => sent.push(s));
    takeOff(p);
    p.air(30);
    const early = tr.status().leg!.stats.flown_nm!;
    p.air(60);
    const later = tr.status().leg!.stats.flown_nm!;
    expect(later).toBeGreaterThan(early);
    expect(sent.at(-1)?.leg?.stats?.flown_nm).toBe(later);
    land(p);
    expect(tr.status().leg).toBeNull();
  });
});
