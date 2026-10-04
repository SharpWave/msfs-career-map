import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..", "..");
export const DATA_DIR = path.join(ROOT, "data");
export const IMAGES_DIR = path.join(DATA_DIR, "images");
export const DB_PATH = process.env.CAREER_DB ?? path.join(DATA_DIR, "career.db");
export const AIRPORTS_CSV = path.join(DATA_DIR, "airports.csv");
export const RUNWAYS_CSV = path.join(DATA_DIR, "runways.csv");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(IMAGES_DIR, { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
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
`);

/** Additive migrations for databases created by earlier versions. */
function addColumnIfMissing(table: string, column: string, ddl: string) {
  const cols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
}
addColumnIfMissing("aircraft", "cruise_kts", "REAL");
addColumnIfMissing("aircraft", "min_runway_ft", "INTEGER");
addColumnIfMissing("aircraft", "simbrief_type", "TEXT");
addColumnIfMissing("aircraft", "ceiling_ft", "INTEGER");
addColumnIfMissing("aircraft", "oxygen", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("aircraft", "max_xwind_kts", "INTEGER");
addColumnIfMissing("aircraft", "ifr_capable", "INTEGER NOT NULL DEFAULT 1");
addColumnIfMissing("airports", "wikipedia_link", "TEXT");
addColumnIfMissing("airports", "home_link", "TEXT");
addColumnIfMissing("runways", "le_heading", "REAL");
addColumnIfMissing("runways", "he_heading", "REAL");
addColumnIfMissing("airport_rwy", "headings", "TEXT");

export function airportCount(): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM airports").get() as { n: number };
  return row.n;
}

export function runwayCount(): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM runways").get() as { n: number };
  return row.n;
}
