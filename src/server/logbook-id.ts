import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

/**
 * The logbook's id: 16 random lowercase hexadecimal characters in the `settings` table under
 * `logbook_id`, which backups are named and pruned by. Works on whichever connection it is given.
 */

export const newLogbookId = (): string => randomBytes(8).toString("hex");

/** The id the logbook holds, or null: none written, or no settings table (a logbook from before it). */
export function readLogbookId(db: DatabaseSync): string | null {
  const table = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'settings'`).get();
  if (!table) return null;
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'logbook_id'`).get() as { value: string } | undefined;
  return row?.value ?? null;
}

/** Write a new id, creating the settings table first in a logbook from before it had one; returns it. */
// @spec APP-DATA-006
export function writeNewLogbookId(db: DatabaseSync): string {
  const id = newLogbookId();
  db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  db.prepare(`INSERT INTO settings (key, value) VALUES ('logbook_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(id);
  return id;
}
