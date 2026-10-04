import fs from "node:fs";
import { db, AIRPORTS_CSV, airportCount } from "./db.ts";

export const AIRPORTS_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv";

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

export async function downloadAirportsCsv(): Promise<void> {
  console.log(`[airports] downloading ${AIRPORTS_URL} ...`);
  const res = await fetch(AIRPORTS_URL);
  if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText}`);
  fs.writeFileSync(AIRPORTS_CSV, Buffer.from(await res.arrayBuffer()));
  console.log(`[airports] saved to ${AIRPORTS_CSV}`);
}

/** Import the OurAirports CSV into the airports table, replacing existing rows. */
export function importAirportsCsv(): number {
  const text = fs.readFileSync(AIRPORTS_CSV, "utf8");
  const rows = parseCsv(text);
  const header = rows.shift()!;
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`CSV missing column ${name}`);
    return i;
  };
  const c = {
    ident: col("ident"),
    type: col("type"),
    name: col("name"),
    lat: col("latitude_deg"),
    lon: col("longitude_deg"),
    elev: col("elevation_ft"),
    country: col("iso_country"),
    region: col("iso_region"),
    muni: col("municipality"),
    icao: col("icao_code"),
    iata: col("iata_code"),
    gps: col("gps_code"),
    local: col("local_code"),
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

/** On startup: populate the airports table, downloading the CSV first if it is missing. */
export async function ensureAirports(): Promise<void> {
  if (airportCount() > 0) return;
  if (!fs.existsSync(AIRPORTS_CSV)) await downloadAirportsCsv();
  console.log("[airports] importing CSV (first run) ...");
  const n = importAirportsCsv();
  console.log(`[airports] imported ${n} airports`);
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
}

const byCodeStmt = db.prepare(`
  SELECT * FROM airports
  WHERE ident = ?1 OR icao_code = ?1 OR gps_code = ?1 OR iata_code = ?1 OR local_code = ?1
  ORDER BY CASE WHEN ident = ?1 THEN 0 WHEN icao_code = ?1 THEN 1 WHEN gps_code = ?1 THEN 2 ELSE 3 END
  LIMIT 1`);

/** Look an airport up by any of its codes (ICAO ident, GPS code, IATA, local). */
export function findAirport(code: string): AirportRow | undefined {
  return byCodeStmt.get(code.trim().toUpperCase()) as AirportRow | undefined;
}

const typeRank = `CASE type
  WHEN 'large_airport' THEN 0 WHEN 'medium_airport' THEN 1 WHEN 'small_airport' THEN 2
  WHEN 'seaplane_base' THEN 3 WHEN 'heliport' THEN 4 ELSE 5 END`;

const searchStmt = db.prepare(`
  SELECT * FROM airports
  WHERE ident LIKE ?1 OR icao_code LIKE ?1 OR gps_code LIKE ?1 OR iata_code LIKE ?1 OR local_code LIKE ?1
     OR name LIKE ?2 OR municipality LIKE ?2
  ORDER BY
    CASE WHEN ident = ?3 OR icao_code = ?3 OR gps_code = ?3 OR iata_code = ?3 THEN 0
         WHEN ident LIKE ?1 OR icao_code LIKE ?1 OR gps_code LIKE ?1 OR iata_code LIKE ?1 OR local_code LIKE ?1 THEN 1
         ELSE 2 END,
    ${typeRank},
    name
  LIMIT ?4`);

export function searchAirports(q: string, limit = 12): AirportRow[] {
  const t = q.trim();
  if (!t) return [];
  const up = t.toUpperCase();
  return searchStmt.all(`${up}%`, `%${t}%`, up, limit) as unknown as AirportRow[];
}
