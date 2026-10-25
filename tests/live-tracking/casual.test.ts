/**
 * Casual mode in the tracker: LIVE-CASUAL-001 to LIVE-CASUAL-015 (switching, the path, restarts,
 * shutdown, a clean MSFS quit and a fresh run), with LIVE-API-010 to LIVE-API-012 and LIVE-LEG-002/003.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../src/server/db.ts";
import { CasualRefused, Tracker, type TrackPoint } from "../../src/server/tracker.ts";
import type { BriefingSummary } from "../../src/server/ofp.ts";
import { KPVD, OTHER, PLANE, fleetAircraft, flyCircuit, pilot, takeOff } from "./pilot.ts";

const hopCount = () => (db.prepare(`SELECT COUNT(*) AS n FROM hops`).get() as { n: number }).n;
const checkpoint = () => JSON.parse((db.prepare(`SELECT json FROM tracker_state WHERE id = 1`).get() as { json: string }).json);

const points = (path: TrackPoint[][]) => path.reduce((n, seg) => n + seg.length, 0);

describe("casual mode in the tracker", () => {
  let tr: Tracker;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    db.exec(`DELETE FROM tracker_state; DELETE FROM hops; DELETE FROM briefings; DELETE FROM aircraft;`);
    tr = new Tracker();
    tr.setConnected(true, "Fake MSFS");
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // @spec LIVE-CASUAL-001
  it("detects no legs while on: a whole flight in a bound aircraft leaves no leg, landing, hop or pending leg", () => {
    fleetAircraft();
    const p = pilot(tr);
    tr.setCasual(true);
    const hops: unknown[] = [];
    tr.on("hop", (h) => hops.push(h));
    p.ground(3);
    p.air(60);
    p.feed({ on_ground: true, gs_kts: 60, touchdown: { t: p.t, fpm: 900, g: 3.8, ias_kts: 62, sim_fpm: 880, pitch_deg: 2, bank_deg: 1 } });
    p.ground(10, 20);
    p.ground(40);
    const st = tr.status();
    expect(st.leg).toBeNull();
    expect(st.phase).toBe("idle");
    expect(st.pending).toEqual([]);
    expect(hops).toEqual([]);
    expect(hopCount()).toBe(0);
    const saved = checkpoint();
    expect(saved).toMatchObject({ phase: "idle", leg: null, lastGround: null, lastAirborne: null, airborneSince: null, stopSince: null });
  });

  // @spec LIVE-CASUAL-002
  it("still follows the sim aircraft and its binding, reports the position, ignores paused and menu samples, and leaves the plan and pending legs alone", () => {
    // A leg in an unbound aircraft waits as pending before casual mode starts.
    const p = pilot(tr, OTHER);
    takeOff(p);
    p.air(80);
    p.home();
    p.ground(5, 30);
    p.ground(35);
    expect(tr.status().pending).toHaveLength(1);
    expect(tr.status().pending[0].reason).toMatch(/no fleet aircraft/);
    const plan = { id: 4242, origin: { icao: "KPVD" }, dest: { icao: "KBOS" } } as unknown as BriefingSummary;
    tr.setBriefing(plan);

    tr.setCasual(true);
    const id = fleetAircraft();
    p.feed({ ...PLANE, on_ground: true, gs_kts: 12 });
    let st = tr.status();
    expect(st.sim).toMatchObject({ title: PLANE.title, livery: PLANE.livery });
    expect(st.aircraft_id).toBe(id);
    expect(st.position).toMatchObject({ gs_kts: 12, on_ground: true });
    expect(st.pending).toHaveLength(1);
    expect(st.pending[0].sim.title).toBe(OTHER.title);
    expect(st.briefing?.id).toBe(4242);

    const before = structuredClone(tr.path());
    tr.setPaused(true);
    p.feed({ ...PLANE, on_ground: false, gs_kts: 100, lat: 45 });
    tr.setPaused(false);
    p.feed({ ...PLANE, on_ground: false, gs_kts: 100, lat: 0, lon: 0 });
    st = tr.status();
    expect(tr.path()).toEqual(before);
    expect(st.position?.lat).toBeCloseTo(KPVD.lat, 1);
    expect(st.briefing?.id).toBe(4242);

    // An unbound aircraft is followed without being called out: nothing is logged to it anyway.
    p.feed({ ...OTHER, on_ground: true, gs_kts: 12 });
    st = tr.status();
    expect(st.aircraft_id).toBeNull();
    expect(st.message).toBe("Flying Test Cub (Yellow)");
  });

  // @spec LIVE-CASUAL-003, LIVE-API-011
  it("adds a point when the path is empty or 5 s after the last one, and none while standing still on the ground", () => {
    const p = pilot(tr);
    tr.setCasual(true);
    const added: TrackPoint[] = [];
    const sent: TrackPoint[][][] = [];
    tr.on("path-point", (pt: TrackPoint) => added.push(pt));
    tr.on("path", (path: TrackPoint[][]) => sent.push(structuredClone(path)));

    p.ground(20);
    expect(tr.path()).toEqual([]);

    p.ground(12, 10);
    p.air(11);
    const path = tr.path();
    expect(path).toHaveLength(1);
    const seg = path[0];
    expect(seg.length).toBe(5);
    for (const pt of seg) expect(pt).toHaveLength(8);
    for (let i = 1; i < seg.length; i++) expect(seg[i][3] - seg[i - 1][3]).toBeGreaterThanOrEqual(5);
    // The first point begins a segment, so it goes out with the whole path; the rest one by one.
    expect(sent).toEqual([[[seg[0]]]]);
    expect(added).toEqual(seg.slice(1));
    expect(tr.status().casual?.points).toBe(5);
  });

  // @spec LIVE-CASUAL-004, LIVE-API-011
  it("starts a new segment with the next point after a position jump, a new flight or a disconnect", () => {
    const p = pilot(tr);
    tr.setCasual(true);
    const sent: TrackPoint[][][] = [];
    tr.on("path", (path: TrackPoint[][]) => sent.push(structuredClone(path)));

    p.air(6);
    expect(tr.path()).toHaveLength(1);

    p.jump(200);
    p.air(1);
    expect(tr.path()).toHaveLength(2);
    expect(tr.path()[1]).toHaveLength(1);
    // The whole path goes out for a new segment, already holding that segment's first point.
    expect(sent.at(-1)).toEqual(tr.path());

    tr.flightLoaded("flight.FLT");
    p.ground(5);
    expect(tr.path()).toHaveLength(2);
    p.ground(1, 8);
    expect(tr.path()).toHaveLength(3);
    expect(tr.path()[2]).toHaveLength(1);

    tr.setConnected(false);
    tr.setConnected(true, "Fake MSFS");
    p.air(1);
    expect(tr.path()).toHaveLength(4);
    expect(points(tr.path())).toBe(tr.status().casual?.points);
  });

  // @spec LIVE-CASUAL-005
  it("closes a landed leg as usual when switched on, and starts with an empty path", () => {
    fleetAircraft();
    const p = pilot(tr);
    takeOff(p);
    p.air(80);
    p.home();
    p.feed({ on_ground: true, gs_kts: 50 });
    expect(tr.status().phase).toBe("landed");

    // Saying to drop the leg never drops a landed one.
    tr.setCasual(true, { dropLeg: true });
    const hop = db.prepare(`SELECT origin, dest FROM hops`).get() as { origin: string; dest: string };
    expect(hop).toEqual({ origin: "KPVD", dest: "KPVD" });
    const st = tr.status();
    expect(st.leg).toBeNull();
    expect(st.casual?.points).toBe(0);
    expect(tr.path()).toEqual([]);
  });

  // @spec LIVE-CASUAL-006
  it("refuses to switch on while a bound fleet aircraft's leg is airborne, unless told to drop it", () => {
    const id = fleetAircraft();
    const p = pilot(tr);
    takeOff(p);
    const departed = tr.status().leg!.departed_at;

    let refusal: unknown;
    try {
      tr.setCasual(true);
    } catch (e) {
      refusal = e;
    }
    expect(refusal).toBeInstanceOf(CasualRefused);
    expect((refusal as CasualRefused).details).toEqual({ aircraft_id: id, name: "Test Comanche · N1TC", origin: "KPVD", departed_at: departed });
    const st = tr.status();
    expect(st.casual).toBeNull();
    expect(st.phase).toBe("airborne");
    expect(st.leg?.origin).toBe("KPVD");
  });

  // @spec LIVE-CASUAL-007
  it("drops an airborne leg when told to, or without asking when no fleet aircraft is bound, and starts the path with its track", () => {
    fleetAircraft();
    const p = pilot(tr);
    takeOff(p);
    p.air(20);
    const track = structuredClone(tr.track());
    expect(track.length).toBeGreaterThan(2);

    tr.setCasual(true, { dropLeg: true });
    let st = tr.status();
    expect(st.leg).toBeNull();
    expect(st.pending).toEqual([]);
    expect(hopCount()).toBe(0);
    expect(tr.path()).toEqual([track]);
    // The flight carries on into the same segment.
    p.air(6);
    expect(tr.path()).toHaveLength(1);
    expect(tr.path()[0].length).toBeGreaterThan(track.length);

    // A bound aircraft that has since been deleted counts as not bound: no question asked.
    tr.setCasual(false);
    p.air(10);
    expect(tr.status().leg).not.toBeNull();
    db.exec(`DELETE FROM aircraft`);
    tr.setCasual(true);
    st = tr.status();
    expect(st.leg).toBeNull();
    expect(st.casual).not.toBeNull();
    expect(tr.path()).toHaveLength(1);
  });

  // @spec LIVE-CASUAL-007
  it("drops an unbound aircraft's airborne leg without asking", () => {
    const p = pilot(tr, OTHER);
    takeOff(p);
    expect(() => tr.setCasual(true)).not.toThrow();
    expect(tr.status().leg).toBeNull();
    expect(tr.path()[0].length).toBeGreaterThan(0);
  });

  // @spec LIVE-CASUAL-008, LIVE-LEG-002, LIVE-LEG-003
  it("drops the path when switched off and detects legs again from the next sample", () => {
    fleetAircraft();
    const p = pilot(tr);
    tr.setCasual(true);
    p.ground(3);
    p.air(20);
    tr.setCasual(false);
    expect(tr.path()).toEqual([]);
    expect(tr.status().casual).toBeNull();
    p.air(1);
    let st = tr.status();
    expect(st.phase).toBe("airborne");
    expect(st.leg?.origin).toBeNull();

    // Switched off on the ground, the next takeoff is named as usual.
    tr.discardLeg("test");
    tr.setCasual(true);
    p.home();
    p.ground(5);
    tr.setCasual(false);
    p.ground(3);
    p.air(10);
    st = tr.status();
    expect(st.leg?.origin).toBe("KPVD");
  });

  // @spec LIVE-CASUAL-009
  it("changes nothing when asked for the state it is already in", () => {
    fleetAircraft();
    const p = pilot(tr);
    tr.setCasual(true);
    p.air(12);
    const before = { path: structuredClone(tr.path()), casual: tr.status().casual };
    const sent: unknown[] = [];
    tr.on("path", (x) => sent.push(x));
    vi.setSystemTime(p.t + 60_000);
    tr.setCasual(true);
    expect(tr.path()).toEqual(before.path);
    expect(tr.status().casual).toEqual(before.casual);
    expect(sent).toEqual([]);

    tr.setCasual(false);
    takeOff(p);
    const leg = tr.status().leg;
    tr.setCasual(false);
    expect(tr.status().leg).toEqual(leg);
  });

  // @spec LIVE-CASUAL-010
  it("empties the path when cleared and stays in casual mode", () => {
    const p = pilot(tr);
    tr.setCasual(true);
    p.air(12);
    const sent: TrackPoint[][][] = [];
    tr.on("path", (x: TrackPoint[][]) => sent.push(x));
    tr.clearPath();
    expect(tr.path()).toEqual([]);
    expect(sent).toEqual([[]]);
    expect(tr.status().casual?.points).toBe(0);
    p.air(1);
    expect(tr.path()).toHaveLength(1);
  });

  // @spec LIVE-CASUAL-011
  it("comes back on after a restart with the time it was switched on and an empty path, still detecting no legs, and stays off once switched off", () => {
    const p = pilot(tr);
    const on = p.t;
    tr.setCasual(true);
    p.air(30);
    expect(points(tr.path())).toBeGreaterThan(0);

    const after = new Tracker();
    expect(after.status().casual).toEqual({ since: new Date(on).toISOString(), points: 0 });
    expect(after.path()).toEqual([]);

    // Leg detection stays suspended after the restart.
    p.use(after);
    takeOff(p);
    expect(after.status().leg).toBeNull();
    expect(hopCount()).toBe(0);

    // Switched off before the next restart, it stays off.
    after.setCasual(false);
    expect(new Tracker().status().casual).toBeNull();
  });

  // @spec LIVE-CASUAL-012
  it("reports switching on and off, naming a dropped leg", () => {
    const p = pilot(tr, OTHER);
    tr.setCasual(true);
    expect(tr.status().message).toBe("Casual mode on: nothing is logged");
    tr.setCasual(false);
    expect(tr.status().message).toBe("Casual mode off: takeoffs and landings are logged again");
    takeOff(p);
    tr.setCasual(true);
    expect(tr.status().message).toBe("Casual mode on: nothing is logged; dropped the leg from KPVD");
    tr.setCasual(false);
    p.air(1);
    expect(tr.status().leg?.origin).toBeNull();
    tr.setCasual(true);
    expect(tr.status().message).toBe("Casual mode on: nothing is logged; dropped the leg from ?");
  });

  // @spec LIVE-CASUAL-013
  it("switches casual mode off and drops the path before the final checkpoint when the app is quitting, so the next start finds it off", () => {
    const p = pilot(tr);
    tr.setCasual(true);
    p.air(12);
    // Without the shutdown, the checkpoint would bring casual mode back on.
    expect(new Tracker().status().casual).not.toBeNull();

    tr.shutdown({ quitting: true });
    expect(tr.status().casual).toBeNull();
    expect(tr.path()).toEqual([]);
    expect(new Tracker().status().casual).toBeNull();
  });

  // @spec LIVE-CASUAL-013
  it("leaves casual mode on in the final checkpoint when the server stops without the app quitting", () => {
    const p = pilot(tr);
    const on = p.t;
    tr.setCasual(true);
    p.air(12);

    tr.shutdown({ quitting: false });
    expect(new Tracker().status().casual?.since).toBe(new Date(on).toISOString());
  });

  // @spec LIVE-CASUAL-014
  it("keeps casual mode and its path through a connection that closed or failed, and switches it off when MSFS quits cleanly", () => {
    const p = pilot(tr);
    const on = p.t;
    tr.setCasual(true);
    p.air(12);

    // A sim crash or a lost connection: the session goes on, the next point starts a new segment.
    const kept = structuredClone(tr.path());
    tr.setConnected(false, null, { quit: false });
    expect(tr.status().casual?.since).toBe(new Date(on).toISOString());
    expect(tr.path()).toEqual(kept);
    tr.setConnected(true, "Fake MSFS");
    p.air(1);
    expect(tr.path()).toHaveLength(2);
    expect(tr.path()[0]).toEqual(kept[0]);

    // SimConnect's quit event: MSFS closed normally.
    const sent: TrackPoint[][][] = [];
    tr.on("path", (x: TrackPoint[][]) => sent.push(structuredClone(x)));
    tr.setConnected(false, null, { quit: true });
    const st = tr.status();
    expect(st.casual).toBeNull();
    expect(tr.path()).toEqual([]);
    expect(sent.at(-1)).toEqual([]);
    expect(st.message).toBe("Casual mode off (MSFS closed): takeoffs and landings are logged again");
    expect(new Tracker().status().casual).toBeNull();
  });

  // @spec LIVE-CASUAL-015
  it("starts with casual mode off on a fresh run whatever the checkpoint holds, and has saved that before the start is done", () => {
    const p = pilot(tr);
    tr.setCasual(true);
    p.air(12);
    // Without the fresh run, the checkpoint would bring casual mode back on.
    expect(new Tracker().status().casual).not.toBeNull();

    const fresh = new Tracker({ freshRun: true });
    expect(fresh.status().casual).toBeNull();
    expect(fresh.path()).toEqual([]);
    // A later start of the same run, made without the fresh-run input, finds it off too.
    expect(new Tracker().status().casual).toBeNull();

    p.use(fresh);
    takeOff(p);
    expect(fresh.status().leg).not.toBeNull();
  });

  // @spec LIVE-CASUAL-015
  it("still restores a leg in progress and the pending legs on a fresh run", () => {
    const p = pilot(tr, OTHER);
    flyCircuit(p); // unbound: kept as pending
    const waiting = tr.status().pending.map((l) => l.id);
    expect(waiting).toHaveLength(1);
    takeOff(p);
    const departed = tr.status().leg?.departed_at;
    expect(departed).toBeTruthy();

    const fresh = new Tracker({ freshRun: true });
    const st = fresh.status();
    expect(st.leg?.departed_at).toBe(departed);
    expect(st.pending.map((l) => l.id)).toEqual(waiting);
  });

  // @spec LIVE-API-010
  it("reports casual mode in its status as the time it was switched on and the point count over all segments", () => {
    const p = pilot(tr);
    expect(tr.status().casual).toBeNull();
    const on = p.t;
    tr.setCasual(true);
    p.air(11);
    p.jump(200);
    p.air(6);
    expect(tr.status().casual).toEqual({ since: new Date(on).toISOString(), points: points(tr.path()) });
    expect(tr.path()).toHaveLength(2);
  });

  // @spec LIVE-API-012
  it("sends the emptied leg track before the path holding it, and the status last, when switching on drops a leg", () => {
    const p = pilot(tr, OTHER);
    takeOff(p);
    const events: string[] = [];
    for (const ev of ["track", "path", "status"]) tr.on(ev, () => events.push(ev));
    tr.setCasual(true);
    const track = events.indexOf("track");
    const path = events.indexOf("path");
    expect(track).toBeGreaterThanOrEqual(0);
    expect(path).toBeGreaterThan(track);
    expect(events.at(-1)).toBe("status");
  });
});
