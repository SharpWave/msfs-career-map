/**
 * The tracker's rows in a Node test's own database: the checkpoint (`tracker_state`), checkpoints
 * set aside (`tracker_state_aside`), hops and SimBrief briefings — read, written and cleared.
 */
import { db } from "../../src/server/db.ts";
import type { BriefingSummary } from "../../src/server/ofp.ts";
import type { Tracker } from "../../src/server/tracker.ts";

const tableExists = (name: string): boolean =>
  db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name) !== undefined;

/** Empty the checkpoint, checkpoints set aside, hops, briefings and the fleet. */
export function resetLogbook(): void {
  db.exec(`DELETE FROM tracker_state; DELETE FROM hops; DELETE FROM briefings; DELETE FROM aircraft;`);
  if (tableExists("tracker_state_aside")) db.exec(`DELETE FROM tracker_state_aside`);
}

/** The checkpoint as stored, or null when there is none. */
export function rawCheckpoint(): string | null {
  const row = db.prepare(`SELECT json FROM tracker_state WHERE id = 1`).get() as { json: string } | undefined;
  return row?.json ?? null;
}

/** The checkpoint parsed, or null when there is none. */
export function readCheckpoint(): Record<string, any> | null {
  const raw = rawCheckpoint();
  return raw == null ? null : JSON.parse(raw);
}

/** Store a checkpoint as a server would find it at its next start: text as is, anything else as JSON. */
export function writeCheckpoint(v: string | object): void {
  const json = typeof v === "string" ? v : JSON.stringify(v);
  db.prepare(
    `INSERT INTO tracker_state (id, json, updated_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
  ).run(json, new Date().toISOString());
}

/**
 * The checkpoints set aside, oldest first, each as the values of its row: the design names the
 * table but not its columns, so a test looks for the text set aside and its time among the values.
 * None while the table does not exist.
 */
export function asideRows(): unknown[][] {
  if (!tableExists("tracker_state_aside")) return [];
  return (db.prepare(`SELECT * FROM tracker_state_aside ORDER BY rowid`).all() as Record<string, unknown>[]).map((r) => Object.values(r));
}

export function hopCount(): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM hops`).get() as { n: number }).n;
}

export interface HopRow {
  id: number;
  aircraft_id: number;
  seq: number;
  origin: string;
  dest: string;
  departed_at: string | null;
  arrived_at: string | null;
  duration_min: number | null;
  briefing_id: number | null;
}

/** Every hop in the logbook, in the order logged. */
export function hopRows(): HopRow[] {
  return db
    .prepare(`SELECT id, aircraft_id, seq, origin, dest, departed_at, arrived_at, duration_min, briefing_id FROM hops ORDER BY id`)
    .all() as unknown as HopRow[];
}

/**
 * An imported SimBrief plan, as `POST /api/tracker/briefing` stores one: a `briefings` row on no
 * hop. Hand the summary to `tracker.setBriefing` to make it the current plan.
 */
export function addBriefing(origin = "KPVD", dest = "KBOS"): BriefingSummary {
  const summary: Omit<BriefingSummary, "id"> = {
    ofp_id: `test-${origin}-${dest}`,
    static_id: null,
    generated_at: "2026-10-12T11:30:00.000Z",
    airline: null,
    flight_number: null,
    callsign: "N1TC",
    aircraft: { icao: "PA24", name: "Comanche", reg: "N1TC" },
    origin: { icao: origin, name: null, rwy: null },
    dest: { icao: dest, name: null, rwy: null },
    alternate: null,
    route: "DCT",
    distance_nm: 45,
    cruise_alt_ft: 6500,
    ete_min: 25,
    fuel: { units: "lbs", ramp: 300, takeoff: 290, landing: 240, burn: 50 },
    weights: { pax: 1, cargo: 0, payload: 200, zfw: 2100, tow: 2390, ldw: 2340 },
    pdf_url: null,
    fixes: [],
  };
  const r = db
    .prepare(
      `INSERT INTO briefings (hop_id, aircraft_id, ofp_id, generated_at, origin, dest, summary, plan_html, ofp, fetched_at)
       VALUES (NULL, NULL, ?, ?, ?, ?, ?, NULL, '{}', ?)`,
    )
    .run(summary.ofp_id, summary.generated_at, origin, dest, JSON.stringify(summary), new Date().toISOString());
  return { ...summary, id: Number(r.lastInsertRowid) };
}

/** The hop a briefing row is linked to: null when none, undefined when the row is gone. */
export function briefingHopId(id: number): number | null | undefined {
  const row = db.prepare(`SELECT hop_id FROM briefings WHERE id = ?`).get(id) as { hop_id: number | null } | undefined;
  return row ? row.hop_id : undefined;
}

/**
 * Discard every pending leg the tracker holds, whatever shape its status gives them in, so a test
 * file sharing one tracker (the server's) can start each test with none waiting.
 */
export function discardAllPending(tr: Tracker): void {
  const st = tr.status() as { pending: unknown };
  const waiting = (Array.isArray(st.pending) ? st.pending : st.pending ? [st.pending] : []) as { id?: string }[];
  const discard = tr.discardPending as unknown as (id?: string) => unknown;
  for (const p of waiting) discard.call(tr, p.id);
}
