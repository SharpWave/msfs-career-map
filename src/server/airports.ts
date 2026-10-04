import fs from "node:fs";
import { db, AIRPORTS_CSV, RUNWAYS_CSV, airportCount, runwayCount } from "./db.ts";

const DATA_BASE = "https://davidmegginson.github.io/ourairports-data";
export const AIRPORTS_URL = `${DATA_BASE}/airports.csv`;
export const RUNWAYS_URL = `${DATA_BASE}/runways.csv`;

export const AIRPORT_TYPES = ["large_airport", "medium_airport", "small_airport", "seaplane_base", "heliport", "balloonport"] as const;

// ---------------------------------------------------------------- CSV

/** Minimal RFC-4180 CSV parser: quoted fields, embedded commas, doubled quotes, newlines. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function readCsv(file: string): { header: string[]; rows: string[][]; col: (name: string) => number } {
  const rows = parseCsv(fs.readFileSync(file, "utf8"));
  const header = rows.shift()!;
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`${file}: missing column ${name}`);
    return i;
  };
  return { header, rows, col };
}

async function download(url: string, dest: string): Promise<void> {
  console.log(`[data] downloading ${url} ...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  console.log(`[data] saved to ${dest}`);
}

export const downloadAirportsCsv = () => download(AIRPORTS_URL, AIRPORTS_CSV);
export const downloadRunwaysCsv = () => download(RUNWAYS_URL, RUNWAYS_CSV);

// ---------------------------------------------------------------- airports import

/** Import the OurAirports airports CSV, replacing existing rows. */
export function importAirportsCsv(): number {
  const { rows, col } = readCsv(AIRPORTS_CSV);
  const c = {
    ident: col("ident"), type: col("type"), name: col("name"),
    lat: col("latitude_deg"), lon: col("longitude_deg"), elev: col("elevation_ft"),
    country: col("iso_country"), region: col("iso_region"), muni: col("municipality"),
    icao: col("icao_code"), iata: col("iata_code"), gps: col("gps_code"), local: col("local_code"),
  };
  const insert = db.prepare(`
    INSERT OR REPLACE INTO airports
      (ident,type,name,lat,lon,elevation_ft,iso_country,iso_region,municipality,icao_code,iata_code,gps_code,local_code)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  let n = 0;
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM airports");
    for (const r of rows) {
      if (r[c.type] === "closed") continue;
      const lat = Number(r[c.lat]);
      const lon = Number(r[c.lon]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const elev = r[c.elev] === "" ? null : Number(r[c.elev]);
      insert.run(
        r[c.ident], r[c.type], r[c.name], lat, lon, elev,
        r[c.country] || null, r[c.region] || null, r[c.muni] || null,
        r[c.icao] || null, r[c.iata] || null, r[c.gps] || null, r[c.local] || null,
      );
      n++;
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return n;
}

// ---------------------------------------------------------------- runways import

export type SurfaceClass = "paved" | "grass" | "gravel" | "dirt" | "water" | "snow" | "unknown";

/** Collapse OurAirports' free-text surface codes ("ASPH-G", "TURF-F", "PIÇARRA"...) into a few classes. */
export function surfaceClass(raw: string): SurfaceClass {
  const u = raw.trim().toUpperCase();
  if (!u || u === "UNK" || u === "UNKNOWN" || u === "N" || u === "X") return "unknown";
  if (/ASP|ASF|CON|CEM|BIT|PEM|TAR|MAC|PAV|BRI|METAL|ALU|PSP|MATS|STEEL|HARD|SEALED/.test(u)) return "paved";
  if (/GRS|GRASS|TURF|SOD|GRE|GRAS|LAWN|MEADOW/.test(u)) return "grass";
  if (/GRVL|GRAVEL|GVL|CRUSH|ROCK|STONE|SHELL|CORAL|LATERITE|PIÇARRA|PICARRA|SHALE|SCORIA/.test(u)) return "gravel";
  if (/DIRT|SOIL|CLAY|EARTH|SAND|GRADED|UNPAVED|VOLCANIC|CINDER|MUD|LOAM|SILT|NATURAL/.test(u)) return "dirt";
  if (/WATER|WAT|LAKE|SEA|RIVER|BAY|OCEAN/.test(u)) return "water";
  if (/SNOW|ICE|GLACIER/.test(u)) return "snow";
  if (/^G$/.test(u)) return "grass";
  if (/^S$/.test(u)) return "dirt";
  if (/^C$/.test(u)) return "paved";
  if (/^D$/.test(u)) return "dirt";
  return "unknown";
}

/** Import the OurAirports runways CSV and rebuild the per-airport summary. */
export function importRunwaysCsv(): number {
  const { rows, col } = readCsv(RUNWAYS_CSV);
  const c = {
    id: col("id"), ident: col("airport_ident"), len: col("length_ft"), wid: col("width_ft"),
    surface: col("surface"), lighted: col("lighted"), closed: col("closed"),
    le: col("le_ident"), he: col("he_ident"),
  };
  const insert = db.prepare(`
    INSERT OR REPLACE INTO runways (id, airport_ident, length_ft, width_ft, surface, surface_class, lighted, closed, le_ident, he_ident)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);
  const num = (s: string) => {
    const n = Number(s);
    return s === "" || !Number.isFinite(n) || n <= 0 ? null : Math.round(n);
  };

  let n = 0;
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM runways");
    for (const r of rows) {
      const ident = r[c.ident];
      if (!ident) continue;
      insert.run(
        Number(r[c.id]), ident, num(r[c.len]), num(r[c.wid]), r[c.surface] || null, surfaceClass(r[c.surface] ?? ""),
        r[c.lighted] === "1" ? 1 : 0, r[c.closed] === "1" ? 1 : 0, r[c.le] || null, r[c.he] || null,
      );
      n++;
    }
    db.exec(`
      DELETE FROM airport_rwy;
      INSERT INTO airport_rwy (ident, max_length_ft, max_width_ft, runway_count, surfaces, paved, lighted)
      SELECT airport_ident, MAX(length_ft), MAX(width_ft), COUNT(*), GROUP_CONCAT(DISTINCT surface_class),
             MAX(surface_class = 'paved'), MAX(lighted)
      FROM runways WHERE closed = 0 GROUP BY airport_ident;`);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return n;
}

/** On startup: make sure airports and runways are loaded, downloading the CSVs if needed. */
export async function ensureReferenceData(): Promise<void> {
  if (airportCount() === 0) {
    if (!fs.existsSync(AIRPORTS_CSV)) await downloadAirportsCsv();
    console.log("[data] importing airports ...");
    console.log(`[data] imported ${importAirportsCsv()} airports`);
  }
  if (runwayCount() === 0) {
    if (!fs.existsSync(RUNWAYS_CSV)) await downloadRunwaysCsv();
    console.log("[data] importing runways ...");
    console.log(`[data] imported ${importRunwaysCsv()} runways`);
  }
}

// ---------------------------------------------------------------- queries

export interface RunwayRow {
  le_ident: string | null;
  he_ident: string | null;
  length_ft: number | null;
  width_ft: number | null;
  surface: string | null;
  surface_class: SurfaceClass;
  lighted: number;
  closed: number;
}

export interface AirportRow {
  ident: string;
  type: string;
  name: string;
  lat: number;
  lon: number;
  elevation_ft: number | null;
  iso_country: string | null;
  iso_region: string | null;
  municipality: string | null;
  icao_code: string | null;
  iata_code: string | null;
  gps_code: string | null;
  local_code: string | null;
  /** Longest open runway, feet (null when no runway data). */
  rwy_max_ft: number | null;
  rwy_count: number;
  /** Comma-separated surface classes present, e.g. "paved,grass". */
  rwy_surfaces: string | null;
  rwy_paved: number;
  rwy_lighted: number;
}

export interface AirportFull extends AirportRow {
  runways: RunwayRow[];
}

const SELECT = `
  SELECT a.*, s.max_length_ft AS rwy_max_ft, COALESCE(s.runway_count, 0) AS rwy_count,
         s.surfaces AS rwy_surfaces, COALESCE(s.paved, 0) AS rwy_paved, COALESCE(s.lighted, 0) AS rwy_lighted
  FROM airports a LEFT JOIN airport_rwy s ON s.ident = a.ident`;

const byCodeStmt = db.prepare(`${SELECT}
  WHERE a.ident = ?1 OR a.icao_code = ?1 OR a.gps_code = ?1 OR a.iata_code = ?1 OR a.local_code = ?1
  ORDER BY CASE WHEN a.ident = ?1 THEN 0 WHEN a.icao_code = ?1 THEN 1 WHEN a.gps_code = ?1 THEN 2 ELSE 3 END
  LIMIT 1`);

/** Look an airport up by any of its codes (ICAO ident, GPS code, IATA, local). */
export function findAirport(code: string): AirportRow | undefined {
  return byCodeStmt.get(code.trim().toUpperCase()) as unknown as AirportRow | undefined;
}

const typeRank = `CASE a.type
  WHEN 'large_airport' THEN 0 WHEN 'medium_airport' THEN 1 WHEN 'small_airport' THEN 2
  WHEN 'seaplane_base' THEN 3 WHEN 'heliport' THEN 4 ELSE 5 END`;

const searchStmt = db.prepare(`${SELECT}
  WHERE a.ident LIKE ?1 OR a.icao_code LIKE ?1 OR a.gps_code LIKE ?1 OR a.iata_code LIKE ?1 OR a.local_code LIKE ?1
     OR a.name LIKE ?2 OR a.municipality LIKE ?2
  ORDER BY
    CASE WHEN a.ident = ?3 OR a.icao_code = ?3 OR a.gps_code = ?3 OR a.iata_code = ?3 THEN 0
         WHEN a.ident LIKE ?1 OR a.icao_code LIKE ?1 OR a.gps_code LIKE ?1 OR a.iata_code LIKE ?1 OR a.local_code LIKE ?1 THEN 1
         ELSE 2 END,
    ${typeRank},
    a.name
  LIMIT ?4`);

export function searchAirports(q: string, limit = 12): AirportRow[] {
  const t = q.trim();
  if (!t) return [];
  const up = t.toUpperCase();
  return searchStmt.all(`${up}%`, `%${t}%`, up, limit) as unknown as AirportRow[];
}

const runwaysStmt = db.prepare(`
  SELECT le_ident, he_ident, length_ft, width_ft, surface, surface_class, lighted, closed
  FROM runways WHERE airport_ident = ? ORDER BY closed, length_ft DESC`);

/** Add each airport's runway list. Cheap enough for a few hundred airports at a time. */
export function attachRunways<T extends AirportRow>(rows: T[]): (T & { runways: RunwayRow[] })[] {
  return rows.map((r) => ({ ...r, runways: runwaysStmt.all(r.ident) as unknown as RunwayRow[] }));
}

// ---------------------------------------------------------------- planner

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function distanceNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const h =
    Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lon2 - lon1) / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h))) * 3440.065;
}

export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export interface PlanOptions {
  rangeNm: number;
  types: string[];
  pavedOnly: boolean;
  minRunwayFt: number | null;
  limit: number;
}

export interface Candidate extends AirportFull {
  distance_nm: number;
  bearing_deg: number;
}

/** Airports within `rangeNm` of the origin that pass the type/runway filters, nearest first. */
export function planCandidates(origin: AirportRow, o: PlanOptions): { candidates: Candidate[]; total: number } {
  const types = o.types.filter((t) => (AIRPORT_TYPES as readonly string[]).includes(t));
  if (types.length === 0) return { candidates: [], total: 0 };

  const dLat = o.rangeNm / 60;
  const cosLat = Math.max(0.05, Math.cos(toRad(origin.lat)));
  const dLon = o.rangeNm / (60 * cosLat);

  const where: string[] = ["a.lat BETWEEN ? AND ?", `a.type IN (${types.map(() => "?").join(",")})`, "a.ident <> ?"];
  const params: (string | number)[] = [origin.lat - dLat, origin.lat + dLat, ...types, origin.ident];
  if (dLon < 180) {
    const lo = origin.lon - dLon;
    const hi = origin.lon + dLon;
    if (lo < -180) {
      where.push("(a.lon >= ? OR a.lon <= ?)");
      params.push(lo + 360, hi);
    } else if (hi > 180) {
      where.push("(a.lon >= ? OR a.lon <= ?)");
      params.push(lo, hi - 360);
    } else {
      where.push("a.lon BETWEEN ? AND ?");
      params.push(lo, hi);
    }
  }
  if (o.minRunwayFt != null) {
    where.push("s.max_length_ft >= ?");
    params.push(o.minRunwayFt);
  }
  if (o.pavedOnly) where.push("s.paved = 1");

  const rows = db.prepare(`${SELECT} WHERE ${where.join(" AND ")}`).all(...params) as unknown as AirportRow[];

  const inRange: (AirportRow & { distance_nm: number; bearing_deg: number })[] = [];
  for (const a of rows) {
    const d = distanceNm(origin.lat, origin.lon, a.lat, a.lon);
    if (d <= o.rangeNm) inRange.push({ ...a, distance_nm: d, bearing_deg: bearingDeg(origin.lat, origin.lon, a.lat, a.lon) });
  }
  inRange.sort((x, y) => x.distance_nm - y.distance_nm);
  const total = inRange.length;
  const capped = inRange.slice(0, o.limit);
  return { candidates: attachRunways(capped), total };
}
