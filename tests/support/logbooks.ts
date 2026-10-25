/**
 * Logbook files made for a test, in a folder of the run's own: a current or an older schema, a
 * logbook id or none, aircraft, hops, uploaded icons, a checkpoint and a restored backup's
 * `backup_icons` table. Built with node:sqlite directly and the schema step's own module (which
 * opens nothing), never through db.ts, so a test can hold several logbooks at once.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { inject } from "vitest";
import { makeDataFolder } from "./run-folder.ts";

export interface LogbookSpec {
  /** "current" (the default), "old" (a column the schema step adds missing), "pre-settings" (no settings table either). */
  schema?: "current" | "old" | "pre-settings";
  /** A logbook id to write; null (the default for old schemas) writes none; undefined writes a fresh one on current schemas. */
  logbookId?: string | null;
  /** Fleet aircraft names; each gets an id 1..n in order. */
  aircraft?: string[];
  /** Hops: [aircraft index (0-based), origin, dest, arrived_at]. */
  hops?: [number, string, string, string | null][];
  /** Icon files for aircraft by index: written to `<folder>/images/aircraft-<id>.png` and named on the row. */
  icons?: Record<number, Buffer>;
  /** The tracker checkpoint's JSON text, as stored. */
  checkpoint?: string | object;
  /** A restored backup's table: file → bytes ({} for an empty one). */
  backupIcons?: Record<string, Buffer>;
}

export const OLD_COLUMN = { table: "hops", column: "sim_arrived_at" };

/** A new folder in the run's folder, with the fixture airport lists (as a data folder has). */
export function logbookFolder(): string {
  return makeDataFolder(inject("runDir")).dir;
}

/** A 16-hex-character logbook id of the test's choosing. */
export const someId = (n: number) => n.toString(16).padStart(16, "0");

/** Write a logbook at `file` (its folder must exist) and return its path. */
export async function writeLogbook(file: string, spec: LogbookSpec = {}): Promise<string> {
  const { applySchema } = await import("../../src/server/schema.ts");
  const db = new DatabaseSync(file);
  try {
    db.exec("PRAGMA journal_mode = WAL");
    applySchema(db);
    const schema = spec.schema ?? "current";
    if (schema !== "current") db.exec(`ALTER TABLE ${OLD_COLUMN.table} DROP COLUMN ${OLD_COLUMN.column}`);
    if (schema === "pre-settings") db.exec(`DROP TABLE settings`);
    const id = spec.logbookId === undefined ? (schema === "current" ? someId(Math.floor(Math.random() * 2 ** 40)) : null) : spec.logbookId;
    if (id) db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('logbook_id', ?)`).run(id);
    const folder = path.dirname(file);
    (spec.aircraft ?? []).forEach((name, i) => {
      const icon = spec.icons?.[i];
      const r = db.prepare(`INSERT INTO aircraft (name) VALUES (?)`).run(name);
      const aircraftId = Number(r.lastInsertRowid);
      if (icon) {
        fs.mkdirSync(path.join(folder, "images"), { recursive: true });
        fs.writeFileSync(path.join(folder, "images", `aircraft-${aircraftId}.png`), icon);
        db.prepare(`UPDATE aircraft SET icon = ? WHERE id = ?`).run(`/images/aircraft-${aircraftId}.png?v=1`, aircraftId);
      }
    });
    const seq = new Map<number, number>();
    for (const [i, origin, dest, arrived] of spec.hops ?? []) {
      const n = (seq.get(i) ?? 0) + 1;
      seq.set(i, n);
      db.prepare(`INSERT INTO hops (aircraft_id, seq, origin, dest, arrived_at, notes) VALUES (?, ?, ?, ?, ?, '')`).run(i + 1, n, origin, dest, arrived);
    }
    if (spec.checkpoint !== undefined) {
      const json = typeof spec.checkpoint === "string" ? spec.checkpoint : JSON.stringify(spec.checkpoint);
      db.prepare(`INSERT INTO tracker_state (id, json, updated_at) VALUES (1, ?, ?)`).run(json, new Date().toISOString());
    }
    if (spec.backupIcons) {
      db.exec(`CREATE TABLE backup_icons (file TEXT PRIMARY KEY, data BLOB NOT NULL)`);
      for (const [f, data] of Object.entries(spec.backupIcons)) db.prepare(`INSERT INTO backup_icons (file, data) VALUES (?, ?)`).run(f, data);
    }
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    db.close();
  }
  return file;
}

/** Open a logbook file read-only for a test's checks; the caller closes it. */
export function openLogbook(file: string): DatabaseSync {
  return new DatabaseSync(file, { readOnly: true });
}

/** A value from a logbook file, by a query; the file is closed again. */
export function queryLogbook<T = Record<string, unknown>>(file: string, sql: string, ...params: (string | number | null)[]): T[] {
  const db = openLogbook(file);
  try {
    return db.prepare(sql).all(...params) as T[];
  } finally {
    db.close();
  }
}

/** The logbook id a file holds, or null. */
export function logbookIdOf(file: string): string | null {
  try {
    return queryLogbook<{ value: string }>(file, `SELECT value FROM settings WHERE key = 'logbook_id'`)[0]?.value ?? null;
  } catch {
    return null;
  }
}

/** Every table and its columns, for comparing a logbook's schema before and after. */
export function schemaOf(file: string): Record<string, string[]> {
  const db = openLogbook(file);
  try {
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name`).all() as { name: string }[];
    const out: Record<string, string[]> = {};
    for (const { name } of tables) out[name] = (db.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[]).map((c) => c.name);
    return out;
  } finally {
    db.close();
  }
}

export const tableNames = (file: string) => Object.keys(schemaOf(file));

/** A small PNG-ish payload, distinct per n. */
export const iconBytes = (n: number) => Buffer.from(`\x89PNG test icon ${n}`);
