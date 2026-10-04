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

CREATE TABLE IF NOT EXISTS aircraft (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  livery     TEXT NOT NULL DEFAULT '',
  color      TEXT NOT NULL DEFAULT '#ff6b35',
  icon       TEXT NOT NULL DEFAULT 'builtin:twin-piston',
  notes      TEXT NOT NULL DEFAULT '',
  visible    INTEGER NOT NULL DEFAULT 1,
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

export function airportCount(): number {
  const row = db.prepare("SELECT COUNT(*) AS n FROM airports").get() as { n: number };
  return row.n;
}
