import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { dataLocations } from "./locations.ts";
import { currentInputs } from "./inputs.ts";
import { setCounts, setLogbookId } from "./status.ts";
import { applySchema } from "./schema.ts";
import { readLogbookId, writeNewLogbookId } from "./logbook-id.ts";

// The database the inputs name, opened the moment this module loads: the server sets its inputs
// (useInputs) before it loads this, and the test servers' fallback names the file's own CAREER_DB.
// @spec APP-DATA-001, APP-SRV-008
const loc = dataLocations(currentInputs().dbPath);
export const DATA_DIR = loc.dir;
export const IMAGES_DIR = loc.imagesDir;
export const DB_PATH = loc.dbPath;
export const AIRPORTS_CSV = loc.airportsCsv;
export const RUNWAYS_CSV = loc.runwaysCsv;

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(IMAGES_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

// @spec APP-DATA-003
applySchema(db);

/** Run `fn` as one transaction: committed when it returns, rolled back when it throws. */
export function transaction<T>(fn: () => T): T {
  db.exec("BEGIN");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    // SQLite may already have rolled back by itself; the error that matters is the first one.
    try {
      db.exec("ROLLBACK");
    } catch {
      // no transaction left open
    }
    throw e;
  }
}

export function airportCount(): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM airports").get() as { n: number };
  return row.n;
}

export function runwayCount(): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM runways").get() as { n: number };
  return row.n;
}

/** Hand the status the counts it reports from memory (it never reads the database itself). */
// @spec APP-API-008
export function reportCounts(): void {
  setCounts({ airports: airportCount(), runways: runwayCount() });
}

// The schema step has run: the logbook is open. A server's start-up work gave it its id already; a
// test server's database, which no start-up work opens, gets one here.
// @spec APP-DATA-006
setLogbookId(readLogbookId(db) ?? writeNewLogbookId(db));
reportCounts();
