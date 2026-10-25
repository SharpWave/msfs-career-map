/**
 * What the installer round trip seeds before its first step: a logbook with hops and a logbook id of its
 * own, kept where app-shell keeps it, and two daily backups named as the server names its own; and the
 * version of the newer build it installs over the running app.
 */
import { DatabaseSync } from "node:sqlite";
import { backupFileName } from "../../src/server/backup.ts";
import { applySchema } from "../../src/server/schema.ts";

const HOPS: [string, string, string, string, number][] = [
  ["KBOS", "KPVD", "2026-09-01T14:00:00.000Z", "2026-09-01T14:42:00.000Z", 42],
  ["KPVD", "KBDL", "2026-09-02T15:10:00.000Z", "2026-09-02T15:51:00.000Z", 41],
  ["KBDL", "KALB", "2026-09-03T13:05:00.000Z", "2026-09-03T13:58:00.000Z", 53],
];

/** A new logbook at `dbFile` (app-shell's schema) holding one aircraft and its hops, with `logbookId`. */
// @spec DESK-DIST-TRIP-003
export function seedLogbook(dbFile: string, logbookId: string): { hops: number } {
  const db = new DatabaseSync(dbFile);
  try {
    applySchema(db);
    db.prepare("INSERT INTO settings (key, value) VALUES ('logbook_id', ?)").run(logbookId);
    const aircraft = db.prepare("INSERT INTO aircraft (name, livery) VALUES ('Round trip Baron', '')").run();
    const hop = db.prepare("INSERT INTO hops (aircraft_id, seq, origin, dest, departed_at, arrived_at, duration_min) VALUES (?, ?, ?, ?, ?, ?, ?)");
    HOPS.forEach(([origin, dest, departed, arrived, minutes], i) => hop.run(aircraft.lastInsertRowid, i + 1, origin, dest, departed, arrived, minutes));
  } finally {
    db.close();
  }
  return { hops: HOPS.length };
}

/** Two daily backups' names for `logbookId`, a day apart, the newer an hour before `now`. */
// @spec DESK-DIST-TRIP-003
export function seededBackupNames(logbookId: string, now: Date): [string, string] {
  const hour = 3_600_000;
  return [
    backupFileName(new Date(now.getTime() - 25 * hour), "daily", logbookId),
    backupFileName(new Date(now.getTime() - hour), "daily", logbookId),
  ];
}

/** The newer build's version: the next patch, as a pre-release of it, above `version`. */
// @spec DESK-DIST-TRIP-002
export function tripVersion(version: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!m) throw new Error(`Not a version: ${version}`);
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}-trip.1`;
}

const runDirectly = process.argv[1] !== undefined && /[\\/]seed\.ts$/i.test(process.argv[1]);
if (runDirectly && process.argv[2] === "--trip-version") console.log(tripVersion(process.argv[3] ?? ""));
