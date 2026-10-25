import { DatabaseSync } from "node:sqlite";

/**
 * The schema step: every table and index the app keeps, created when missing, and every column a
 * later version added, added in place. Shared by the server's own connection (db.ts) and the
 * start-up work's (startup-work.ts); it opens nothing itself.
 */

/** Every table and index, as created in a new logbook. */
export const TABLES_SQL = `
CREATE TABLE IF NOT EXISTS airports (
  ident        TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  name         TEXT NOT NULL,
  lat          REAL NOT NULL,
  lon          REAL NOT NULL,
  elevation_ft INTEGER,
  iso_country  TEXT,
  iso_region   TEXT,
  municipality TEXT,
  icao_code    TEXT,
  iata_code    TEXT,
  gps_code     TEXT,
  local_code   TEXT
);
CREATE INDEX IF NOT EXISTS airports_name  ON airports(name);
CREATE INDEX IF NOT EXISTS airports_icao  ON airports(icao_code);
CREATE INDEX IF NOT EXISTS airports_gps   ON airports(gps_code);
CREATE INDEX IF NOT EXISTS airports_iata  ON airports(iata_code);
CREATE INDEX IF NOT EXISTS airports_local ON airports(local_code);
CREATE INDEX IF NOT EXISTS airports_lat   ON airports(lat);

CREATE TABLE IF NOT EXISTS runways (
  id            INTEGER PRIMARY KEY,
  airport_ident TEXT NOT NULL,
  length_ft     INTEGER,
  width_ft      INTEGER,
  surface       TEXT,
  surface_class TEXT NOT NULL,
  lighted       INTEGER NOT NULL DEFAULT 0,
  closed        INTEGER NOT NULL DEFAULT 0,
  le_ident      TEXT,
  he_ident      TEXT,
  le_heading    REAL,
  he_heading    REAL
);
CREATE INDEX IF NOT EXISTS runways_airport ON runways(airport_ident);

-- One row per airport summarising its open runways; rebuilt after every runway import.
CREATE TABLE IF NOT EXISTS airport_rwy (
  ident         TEXT PRIMARY KEY,
  max_length_ft INTEGER,
  max_width_ft  INTEGER,
  runway_count  INTEGER NOT NULL,
  surfaces      TEXT,
  paved         INTEGER NOT NULL DEFAULT 0,
  lighted       INTEGER NOT NULL DEFAULT 0,
  headings      TEXT
);

-- Small key/value cache for fetched reference data (e.g. SimBrief's aircraft list).
CREATE TABLE IF NOT EXISTS kv_cache (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

-- Cached Wikipedia page summaries, keyed by airport ident.
CREATE TABLE IF NOT EXISTS wiki_cache (
  ident      TEXT PRIMARY KEY,
  title      TEXT,
  extract    TEXT,
  thumbnail  TEXT,
  image      TEXT,
  url        TEXT,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS aircraft (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  livery     TEXT NOT NULL DEFAULT '',
  color      TEXT NOT NULL DEFAULT '#ff6b35',
  icon       TEXT NOT NULL DEFAULT 'builtin:twin-piston',
  notes      TEXT NOT NULL DEFAULT '',
  visible    INTEGER NOT NULL DEFAULT 1,
  cruise_kts    REAL,
  min_runway_ft INTEGER,
  simbrief_type TEXT,
  ceiling_ft    INTEGER,
  oxygen        INTEGER NOT NULL DEFAULT 0,
  max_xwind_kts INTEGER,
  ifr_capable   INTEGER NOT NULL DEFAULT 1,
  cruise_alt_ft INTEGER,
  climb_fpm     INTEGER,
  climb_kts     INTEGER,
  descent_fpm   INTEGER,
  overhead_min  INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS hops (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  aircraft_id  INTEGER NOT NULL REFERENCES aircraft(id) ON DELETE CASCADE,
  seq          INTEGER NOT NULL,
  origin       TEXT NOT NULL,
  dest         TEXT NOT NULL,
  departed_at  TEXT,
  arrived_at   TEXT,
  duration_min INTEGER,
  notes        TEXT NOT NULL DEFAULT '',
  track        TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS hops_aircraft ON hops(aircraft_id, seq);

-- Single-row checkpoint of the live tracker (in-progress leg, pending legs, casual mode, last sample).
CREATE TABLE IF NOT EXISTS tracker_state (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  json       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Checkpoints the tracker could not read at a start, kept whole for recovery by hand; never read back.
CREATE TABLE IF NOT EXISTS tracker_state_aside (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  json         TEXT NOT NULL,
  set_aside_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- SimBrief OFPs imported per flight: a compact summary for lists/maps, the OFP text as HTML,
-- and the raw JSON as the archived artifact.
CREATE TABLE IF NOT EXISTS briefings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  hop_id       INTEGER REFERENCES hops(id) ON DELETE SET NULL,
  aircraft_id  INTEGER REFERENCES aircraft(id) ON DELETE SET NULL,
  ofp_id       TEXT,
  generated_at TEXT,
  origin       TEXT,
  dest         TEXT,
  summary      TEXT NOT NULL,
  plan_html    TEXT,
  ofp          TEXT NOT NULL,
  fetched_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS briefings_hop ON briefings(hop_id);
`;

/**
 * Columns added to existing tables by later versions, in the order they were added: [table, column,
 * type]. Each is nullable or has a default, as SQLite requires of a column added in place.
 */
// @spec APP-DATA-009, LOG-REC-002
export const ADDED_COLUMNS: readonly [string, string, string][] = [
  ["aircraft", "cruise_kts", "REAL"],
  ["aircraft", "min_runway_ft", "INTEGER"],
  ["aircraft", "simbrief_type", "TEXT"],
  ["aircraft", "ceiling_ft", "INTEGER"],
  ["aircraft", "oxygen", "INTEGER NOT NULL DEFAULT 0"],
  ["aircraft", "max_xwind_kts", "INTEGER"],
  ["aircraft", "ifr_capable", "INTEGER NOT NULL DEFAULT 1"],
  ["aircraft", "cruise_alt_ft", "INTEGER"],
  ["aircraft", "climb_fpm", "INTEGER"],
  ["aircraft", "climb_kts", "INTEGER"],
  ["aircraft", "descent_fpm", "INTEGER"],
  ["aircraft", "overhead_min", "INTEGER"],
  ["aircraft", "sim_title", "TEXT"],
  ["aircraft", "sim_livery", "TEXT"],
  ["hops", "landings", "TEXT"],
  ["hops", "stats", "TEXT"],
  ["hops", "briefing_id", "INTEGER"],
  ["hops", "sim_departed_at", "TEXT"],
  ["hops", "sim_arrived_at", "TEXT"],
  ["airports", "wikipedia_link", "TEXT"],
  ["airports", "home_link", "TEXT"],
  ["airports", "unlisted", "INTEGER NOT NULL DEFAULT 0"],
  ["runways", "le_heading", "REAL"],
  ["runways", "he_heading", "REAL"],
  ["airport_rwy", "headings", "TEXT"],
];

const columnsOf = (db: DatabaseSync, table: string): string[] =>
  (db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map((c) => c.name);

const objectNames = (db: DatabaseSync, type: "table" | "index"): Set<string> =>
  new Set((db.prepare(`SELECT name FROM sqlite_master WHERE type = ?`).all(type) as { name: string }[]).map((r) => r.name));

/**
 * Run the schema step as one transaction: committed whole, or rolled back whole when any statement
 * fails, so an upgrade cut short leaves the logbook as it was. It only ever adds tables, indexes and
 * columns.
 */
// @spec APP-DATA-005, APP-DATA-009
export function applySchema(db: DatabaseSync): void {
  db.exec("BEGIN");
  try {
    db.exec(TABLES_SQL);
    for (const [table, column, ddl] of ADDED_COLUMNS) {
      if (!columnsOf(db, table).includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    }
    db.exec("COMMIT");
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // SQLite rolled back by itself
    }
    throw e;
  }
}

/** Whether the database holds the app's tables (a logbook), as opposed to a new or empty file. */
export function holdsAppTables(db: DatabaseSync): boolean {
  const tables = objectNames(db, "table");
  return tables.has("aircraft") || tables.has("hops");
}

let shape: { tables: string[]; indexes: string[] } | null = null;
/** The tables and indexes the schema step creates, worked out once on an in-memory database. */
function schemaShape() {
  if (!shape) {
    const mem = new DatabaseSync(":memory:");
    try {
      mem.exec(TABLES_SQL);
      shape = { tables: [...objectNames(mem, "table")].filter((n) => !n.startsWith("sqlite_")), indexes: [...objectNames(mem, "index")].filter((n) => !n.startsWith("sqlite_")) };
    } finally {
      mem.close();
    }
  }
  return shape;
}

/**
 * Whether opening this database is a schema upgrade: it holds the app's tables and the schema step
 * would add a table, an index or a column to it. A new database, or a current one, is none. Reads
 * only.
 */
// @spec APP-DATA-004
export function upgradeNeeded(db: DatabaseSync): boolean {
  if (!holdsAppTables(db)) return false;
  const tables = objectNames(db, "table");
  const indexes = objectNames(db, "index");
  const { tables: wantTables, indexes: wantIndexes } = schemaShape();
  if (wantTables.some((t) => !tables.has(t))) return true;
  if (wantIndexes.some((i) => !indexes.has(i))) return true;
  return ADDED_COLUMNS.some(([table, column]) => tables.has(table) && !columnsOf(db, table).includes(column));
}
