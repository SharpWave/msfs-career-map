import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../src/server/db.ts";
import type { Touchdown } from "../../src/server/simconnect.ts";
import { Tracker } from "../../src/server/tracker.ts";
import { fleetAircraft, pilot, takeOff } from "./pilot.ts";

/** What the frame watcher measured, landing at time `t`. */
const measured = (t: number, fpm: number, g: number): Touchdown => ({ t, fpm, g, ias_kts: 62, sim_fpm: fpm - 10, pitch_deg: 3, bank_deg: 0 });

describe("the Logged message", () => {
  let tr: Tracker;
  let logged: (string | null)[];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    db.exec(`DELETE FROM tracker_state; DELETE FROM hops; DELETE FROM briefings; DELETE FROM aircraft;`);
    tr = new Tracker();
    tr.setConnected(true, "Fake MSFS");
    logged = [];
    tr.on("hop", () => logged.push(tr.status().message));
    fleetAircraft();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // @spec LIVE-HOP-006, PANEL-LOOK-004
  it("names the first touchdown of a bounced landing", () => {
    const p = pilot(tr);
    takeOff(p);
    p.air(80);
    p.home();
    p.feed({ on_ground: true, gs_kts: 60, touchdown: measured(p.t, 420, 1.9) });
    p.air(2, 60);
    p.feed({ on_ground: true, gs_kts: 55, touchdown: measured(p.t, 90, 1.2) });
    p.ground(5, 30);
    p.ground(35);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatch(/^Logged KPVD → KPVD, \d+ min, 420 fpm hard$/);
  });

  // @spec LIVE-HOP-006, PANEL-LOOK-004
  it("names the final landing after a touch-and-go circuit", () => {
    const p = pilot(tr);
    takeOff(p);
    p.air(80);
    p.home();
    p.feed({ on_ground: true, gs_kts: 60, touchdown: measured(p.t, 450, 1.9) });
    p.ground(3, 60);
    p.air(120);
    p.home();
    p.feed({ on_ground: true, gs_kts: 60, touchdown: measured(p.t, 80, 1.1) });
    p.ground(5, 30);
    p.ground(35);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatch(/^Logged KPVD → KPVD, \d+ min, 80 fpm butter$/);
  });
});
