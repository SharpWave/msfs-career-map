/**
 * Flying a tracker by hand in Node tests: a fleet aircraft bound to the sim aircraft, and a pilot
 * that feeds one sample a second.
 */
import { vi } from "vitest";
import { db } from "../../src/server/db.ts";
import type { SimSample } from "../../src/server/simconnect.ts";
import type { Tracker } from "../../src/server/tracker.ts";

export const KPVD = { lat: 41.7246, lon: -71.4282 };
/** About 30 nm north of KPVD: no fixture airport lies within 5 nm of it (KOWD, the nearest, is 11 nm away). */
export const NOWHERE = { lat: 42.2246, lon: -71.4282 };
export const PLANE = { title: "Test Comanche", livery: "N1TC", atc_id: "N1TC" };
export const OTHER = { title: "Test Cub", livery: "Yellow", atc_id: "N2TC" };

/** A fleet aircraft bound to a sim title and livery. */
export function fleetAircraft(sim = PLANE, name = "Test Comanche", livery = "N1TC"): number {
  const r = db
    .prepare(`INSERT INTO aircraft (name, livery, sim_title, sim_livery) VALUES (?, ?, ?, ?)`)
    .run(name, livery, sim.title, sim.livery);
  return Number(r.lastInsertRowid);
}

/**
 * Flies a tracker by hand, one sample a second, moving north while it has ground speed. The clock
 * follows the samples so the tracker's checkpoints are taken as they would be in flight.
 */
export function pilot(tr: Tracker, sim: typeof PLANE = PLANE) {
  let target = tr;
  let t = Date.parse("2026-10-12T12:00:00Z");
  let lat = KPVD.lat;
  let lon = KPVD.lon;
  vi.setSystemTime(t);
  const feed = (over: Partial<SimSample>): SimSample => {
    const s: SimSample = {
      t, lat, lon, alt_ft: 60, on_ground: true, gs_kts: 0, hdg_deg: 0, vs_fpm: 0, ias_kts: 0, g: 1,
      fuel_lb: 300, weight_lb: 2400, ...sim, ...over,
    };
    target.feed(s);
    if (s.gs_kts >= 1) lat += s.gs_kts / 3600 / 60; // nm per second as degrees of latitude
    t += 1000;
    vi.setSystemTime(t);
    return s;
  };
  return {
    get t() {
      return t;
    },
    /** n seconds on the ground at gs knots. */
    ground: (n: number, gs = 0) => { for (let i = 0; i < n; i++) feed({ on_ground: true, gs_kts: gs, alt_ft: 60 }); },
    /** n seconds airborne. */
    air: (n: number, gs = 100) => { for (let i = 0; i < n; i++) feed({ on_ground: false, gs_kts: gs, alt_ft: 1500, vs_fpm: 0, ias_kts: gs }); },
    /** Jump `nm` north in one second. */
    jump: (nm: number) => { lat += nm / 60; },
    /** Back over KPVD. */
    home: () => { lat = KPVD.lat; lon = KPVD.lon; },
    /** Over `pos` from the next sample on (e.g. NOWHERE). */
    moveTo: (pos: { lat: number; lon: number }) => { lat = pos.lat; lon = pos.lon; },
    /** Let `sec` seconds pass with no sample (a server down, a sim not reporting). */
    wait: (sec: number) => { t += sec * 1000; vi.setSystemTime(t); },
    /**
     * Feed another tracker from the next sample on — the one a server restart restored — keeping
     * this pilot's clock and position, so the flight carries on where it was.
     */
    use: (next: Tracker) => { target = next; },
    feed,
  };
}

export type Pilot = ReturnType<typeof pilot>;

/** On the ground at KPVD, then airborne long enough to start a leg there. */
export function takeOff(p: Pilot) {
  p.ground(3);
  p.air(10);
}

/** Back over KPVD: touch down, roll out at 30 kt, then stand still until the leg closes there. */
export function land(p: Pilot) {
  p.home();
  p.ground(5, 30);
  p.ground(35);
}

/**
 * A whole circuit at KPVD: takeoff, 80 s out, back, touchdown and stop, closing the leg with a
 * flight time of about 2 min. Bound, it is logged KPVD → KPVD; unbound, it is kept as pending.
 */
export function flyCircuit(p: Pilot) {
  takeOff(p);
  p.air(80);
  land(p);
}
