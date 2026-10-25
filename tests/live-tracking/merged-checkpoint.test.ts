/**
 * The checkpoint written into a logbook being brought in (LIVE-SAVE-008, 009, 010, 011, 015;
 * LIVE-HOP-007): this server's own flying kept with its plans copied over and its pending legs'
 * aircraft cleared, the source's pending legs added as they are, the source's leg in progress kept
 * as a pending leg, what cannot be read set aside in the copy, and the binding looked up again.
 *
 * The source's checkpoint is a real one: a tracker flown in this file's own database, its
 * checkpoint taken, the database then cleared for this server's own flying.
 */
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../../src/server/db.ts";
import { Tracker, checkpointProblem } from "../../src/server/tracker.ts";
import { logbookFolder, queryLogbook, someId, writeLogbook } from "../support/logbooks.ts";
import { NOWHERE, OTHER, PLANE, fleetAircraft, flyCircuit, pilot, takeOff } from "./pilot.ts";
import { addBriefing, rawCheckpoint, resetLogbook } from "./state.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const NOW = new Date("2026-10-25T06:00:00.000Z");
const MID_LEG = "brought in from another logbook mid-leg";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  resetLogbook();
});
afterEach(() => {
  vi.useRealTimers();
});

/**
 * The source's checkpoint, flown here: `fly` runs on a tracker with a fleet aircraft bound to
 * PLANE (id 1) and a current briefing (id 1); then this file's database is emptied again.
 */
function sourceCheckpoint(fly: (tr: Tracker, p: ReturnType<typeof pilot>) => void): Record<string, any> {
  // Ids from 1 again, as the source logbook (the copy) numbers its rows.
  db.exec(`DELETE FROM sqlite_sequence WHERE name IN ('aircraft', 'briefings')`);
  const tr = new Tracker();
  tr.setConnected(true, "Fake MSFS");
  fleetAircraft();
  tr.setBriefing(addBriefing("KPVD", "KBOS"));
  const p = pilot(tr);
  fly(tr, p);
  tr.saveNow();
  const cp = JSON.parse(rawCheckpoint()!);
  resetLogbook();
  return cp;
}

/** The copy: its own fleet (PLANE bound as aircraft 1, OTHER as 2) and briefings 1..3, as the source logbook holds them. */
async function copyFile(): Promise<string> {
  const file = path.join(logbookFolder(), "career.db.incoming");
  await writeLogbook(file, { logbookId: someId(0xc0), aircraft: ["Their Comanche", "Their Cub"] });
  const c = new DatabaseSync(file);
  c.prepare(`UPDATE aircraft SET sim_title = ?, sim_livery = ? WHERE id = 1`).run(PLANE.title, PLANE.livery);
  c.prepare(`UPDATE aircraft SET sim_title = ?, sim_livery = ? WHERE id = 2`).run(OTHER.title, OTHER.livery);
  for (const id of [1, 2, 3]) {
    c.prepare(
      `INSERT INTO briefings (id, hop_id, aircraft_id, ofp_id, origin, dest, summary, ofp, fetched_at) VALUES (?, NULL, 1, ?, 'KPVD', 'KBOS', ?, '{}', '')`,
    ).run(id, `theirs-${id}`, JSON.stringify({ id, ofp_id: `theirs-${id}` }));
  }
  c.close();
  return file;
}

/** Write the merged checkpoint into `file` with tracker `tr` and the source's checkpoint, and read it back. */
function merge(tr: Tracker, file: string, source: object | string | null) {
  const copy = new DatabaseSync(file);
  try {
    tr.writeMergedCheckpoint(copy, source == null ? null : typeof source === "string" ? source : JSON.stringify(source), NOW);
  } finally {
    copy.close();
  }
  const [row] = queryLogbook<{ json: string }>(file, `SELECT json FROM tracker_state WHERE id = 1`);
  return JSON.parse(row.json);
}

/** This server's own flying: an airborne leg in PLANE (bound here as `ownPlane`), a current plan and a pending leg kept with its plan. */
function ownFlying() {
  const ownPlane = fleetAircraft(PLANE, "Here Comanche");
  const tr = new Tracker();
  tr.setConnected(true, "Fake MSFS");
  const p = pilot(tr, OTHER);
  const pendingPlan = addBriefing("KPVD", "KORH");
  tr.setBriefing(pendingPlan);
  flyCircuit(p); // OTHER is unbound here: kept as pending, with that plan
  const [pending] = tr.status().pending;
  const q = pilot(tr, PLANE);
  q.home();
  const current = addBriefing("KPVD", "KACK");
  tr.setBriefing(current);
  takeOff(q);
  q.air(30);
  tr.saveNow();
  return { tr, ownPlane, pending, current, pendingPlan };
}

describe("this server's own flying (LIVE-SAVE-008)", () => {
  // @spec LIVE-SAVE-008
  it("keeps its leg in progress, current plan, casual switch and pending legs first, plans copied into the copy and pending legs' aircraft cleared", async () => {
    const { tr, pending, current, pendingPlan } = ownFlying();
    const own = JSON.parse(rawCheckpoint()!);
    const file = await copyFile();
    const merged = merge(tr, file, null);

    expect(merged.phase).toBe("airborne");
    expect(merged.leg).toEqual(JSON.parse(JSON.stringify(own.leg)));
    expect(merged.casual).toBeNull();
    expect(merged.pending).toHaveLength(1);
    expect(merged.pending[0]).toMatchObject({ id: pending.id, origin: pending.origin, aircraft_id: null });

    // Each plan copied in as a row of the copy's own, on no hop and no aircraft, and pointed at.
    const copiedCurrent = merged.briefing.id;
    const copiedPending = merged.pending[0].briefing_id;
    expect(copiedCurrent).not.toBe(copiedPending);
    const rows = queryLogbook<{ id: number; hop_id: number | null; aircraft_id: number | null; ofp_id: string }>(
      file,
      `SELECT id, hop_id, aircraft_id, ofp_id FROM briefings WHERE id IN (?, ?) ORDER BY id`,
      copiedCurrent,
      copiedPending,
    );
    expect(rows.map((r) => [r.ofp_id, r.hop_id, r.aircraft_id]).sort()).toEqual([
      [current.ofp_id, null, null],
      [pendingPlan.ofp_id, null, null],
    ].sort());
    expect(merged.briefing).toMatchObject({ ofp_id: current.ofp_id });
    // The copy's own plans are left as they were.
    expect(queryLogbook(file, `SELECT COUNT(*) AS n FROM briefings WHERE ofp_id LIKE 'theirs-%'`)).toEqual([{ n: 3 }]);
  });

  // @spec LIVE-SAVE-008, LIVE-BIND-001
  it("looks the binding of the sim aircraft being flown up again in the copy", async () => {
    const { tr, ownPlane } = ownFlying();
    expect(tr.status().aircraft_id).toBe(ownPlane);
    const file = await copyFile();
    const merged = merge(tr, file, null);
    expect(merged.aircraft_id).toBe(1); // the copy's own row bound to PLANE
  });

  // @spec LIVE-SAVE-008
  it("keeps casual mode as it is here", async () => {
    const tr = new Tracker();
    tr.setCasual(true);
    const since = Date.parse(tr.status().casual!.since);
    const file = await copyFile();
    const merged = merge(tr, file, null);
    expect(merged.casual).toEqual({ since });
  });
});

describe("the source's pending legs (LIVE-SAVE-010, LIVE-SAVE-015)", () => {
  // @spec LIVE-SAVE-010
  it("adds them after this server's own, as the source holds them, with their ids, aircraft and plans", async () => {
    const source = sourceCheckpoint((tr, p) => {
      // A leg with no airport at its end: kept as pending with the source's aircraft 1 and briefing 1.
      takeOff(p);
      p.air(80);
      p.moveTo(NOWHERE);
      p.ground(5, 30); // down away from any airport
      p.ground(35);
    });
    expect(source.pending).toHaveLength(1);
    const { tr, pending } = ownFlying();
    const file = await copyFile();
    const merged = merge(tr, file, source);
    expect(merged.pending.map((l: { id: string }) => l.id)).toEqual([pending.id, source.pending[0].id]);
    expect(merged.pending[1]).toEqual(source.pending[0]);
    expect(merged.pending[1]).toMatchObject({ aircraft_id: 1, briefing_id: 1 });
  });

  // @spec LIVE-SAVE-015, LIVE-SAVE-010
  it("sets a source pending leg it cannot read aside in the copy, with the time, and leaves it out", async () => {
    const source = sourceCheckpoint((tr, p) => {
      takeOff(p);
      p.air(80);
      p.moveTo(NOWHERE);
      p.ground(5, 30); // down away from any airport
      p.ground(35);
    });
    const bad = { id: "not-a-leg", reason: 42 };
    source.pending.push(bad);
    const tr = new Tracker();
    const file = await copyFile();
    const merged = merge(tr, file, source);
    expect(merged.pending.map((l: { id: string }) => l.id)).toEqual([source.pending[0].id]);
    const aside = queryLogbook<Record<string, unknown>>(file, `SELECT * FROM tracker_state_aside`);
    expect(aside).toHaveLength(1);
    const values = Object.values(aside[0]);
    expect(values).toContain(JSON.stringify(bad));
    expect(values).toContain(NOW.toISOString());
  });
});

describe("the source's leg in progress (LIVE-SAVE-011, LIVE-HOP-007)", () => {
  // @spec LIVE-SAVE-011, LIVE-HOP-007
  it("adds an airborne leg last as a pending leg of its own, ending at its last sample, with the source's aircraft and plan and no destination", async () => {
    const source = sourceCheckpoint((tr, p) => {
      takeOff(p);
      p.air(40);
    });
    expect(source.phase).toBe("airborne");
    const tr = new Tracker();
    const file = await copyFile();
    const merged = merge(tr, file, source);
    expect(merged.pending).toHaveLength(1);
    const kept = merged.pending[0];
    expect(kept.id).toMatch(UUID);
    expect(kept).toMatchObject({
      origin: "KPVD",
      dest: null,
      aircraft_id: 1,
      briefing_id: source.briefing.id,
      reason: MID_LEG,
      ended_in_air: true,
      departed_at: new Date(source.leg.departed_at).toISOString(),
      arrived_at: new Date(source.last.t).toISOString(),
      sim: { title: PLANE.title, livery: PLANE.livery },
    });
    const lastPoint = kept.track[kept.track.length - 1];
    expect(lastPoint[3]).toBe(Math.round(source.last.t / 1000));
    // Nothing of the source's own flying stays in progress, and its plan is the kept leg's.
    expect(merged.leg).toBeNull();
    expect(queryLogbook(file, `SELECT id FROM briefings WHERE id = ?`, source.briefing.id)).toHaveLength(1);
  });

  // @spec LIVE-SAVE-011, LIVE-HOP-007, LIVE-NAME-003
  it("names the airport nearest the last sample as the destination of a landed leg", async () => {
    const source = sourceCheckpoint((tr, p) => {
      takeOff(p);
      p.air(80);
      p.home();
      p.ground(5, 30); // landed, rolling: not yet closed
    });
    expect(source.phase).toBe("landed");
    const tr = new Tracker();
    const file = await copyFile();
    const kept = merge(tr, file, source).pending[0];
    expect(kept).toMatchObject({ dest: "KPVD", reason: MID_LEG, ended_in_air: false });
  });

  // @spec LIVE-SAVE-015, LIVE-SAVE-011
  it("sets a source leg in progress it cannot read aside in the copy", async () => {
    const source = sourceCheckpoint((tr, p) => {
      takeOff(p);
      p.air(40);
    });
    source.leg.track = "not a track";
    const tr = new Tracker();
    const file = await copyFile();
    const merged = merge(tr, file, source);
    expect(merged.pending).toEqual([]);
    const aside = queryLogbook<Record<string, unknown>>(file, `SELECT * FROM tracker_state_aside`);
    expect(aside).toHaveLength(1);
    expect(Object.values(aside[0])).toContain(JSON.stringify(source.leg));
  });

  // @spec LIVE-SAVE-011
  it("drops the source's current plan from the copy when no kept leg carries it and no hop uses it", async () => {
    const source = sourceCheckpoint(() => {});
    expect(source.leg).toBeNull();
    expect(source.briefing?.id).toBe(1);
    const tr = new Tracker();
    const file = await copyFile();
    merge(tr, file, source);
    expect(queryLogbook(file, `SELECT id FROM briefings WHERE id = 1`)).toEqual([]);
    expect(queryLogbook(file, `SELECT COUNT(*) AS n FROM briefings`)).toEqual([{ n: 2 }]);
  });

  // @spec LIVE-SAVE-011
  it("keeps the source's current plan when a hop uses it", async () => {
    const source = sourceCheckpoint(() => {});
    const tr = new Tracker();
    const file = await copyFile();
    const c = new DatabaseSync(file);
    c.prepare(`INSERT INTO hops (aircraft_id, seq, origin, dest, notes, briefing_id) VALUES (1, 1, 'KPVD', 'KBOS', '', 1)`).run();
    c.close();
    merge(tr, file, source);
    expect(queryLogbook(file, `SELECT id FROM briefings WHERE id = 1`)).toEqual([{ id: 1 }]);
  });
});

describe("a checkpoint the tracker cannot read (LIVE-SAVE-009)", () => {
  // @spec LIVE-SAVE-009
  it("says nothing is wrong with no checkpoint or a readable one", () => {
    expect(checkpointProblem(null)).toBeNull();
    const source = sourceCheckpoint((tr, p) => takeOff(p));
    expect(checkpointProblem(JSON.stringify(source))).toBeNull();
  });

  // @spec LIVE-SAVE-009
  it.each<[string, string]>([
    ["not JSON", "{half"],
    ["not an object", "[1,2]"],
    ["an unknown phase", JSON.stringify({ phase: "hovering" })],
    ["a field of the wrong type", JSON.stringify({ phase: "idle", pending: 7 })],
  ])("gives the reason for one that is %s", (_what, json) => {
    expect(checkpointProblem(json)).toEqual(expect.any(String));
  });

  // @spec LIVE-SAVE-009, LIVE-SAVE-015
  it("reads one whose single pending leg or leg in progress is damaged, which is set aside instead", () => {
    const source = sourceCheckpoint((tr, p) => takeOff(p));
    source.leg.track = 5;
    source.pending = [{ id: "x" }];
    expect(checkpointProblem(JSON.stringify(source))).toBeNull();
  });
});
