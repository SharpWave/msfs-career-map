import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { AirportDataReport } from "./status.ts";
import { USER_AGENT } from "./version.ts";

/**
 * Everything that writes airport data: the OurAirports list files in the data folder and their
 * download times, bounded downloads, seeding from the program folder, the import in short batches
 * into staging tables and the one short swap, and `AirportWork`, which runs preparation at start, the
 * daily checks with the monthly refresh, and requested re-imports one at a time. It opens no database
 * and reads no tracker: the database, the folders and the in-the-sim check are handed in.
 */

const DATA_BASE = "https://davidmegginson.github.io/ourairports-data";
export const AIRPORTS_URL = `${DATA_BASE}/airports.csv`;
export const RUNWAYS_URL = `${DATA_BASE}/runways.csv`;

export const LIST_NAMES = { airports: "airports.csv", runways: "runways.csv" } as const;
export type ListName = keyof typeof LIST_NAMES;
const LISTS: ListName[] = ["airports", "runways"];
const URLS: Record<ListName, string> = { airports: AIRPORTS_URL, runways: RUNWAYS_URL };

export const DOWNLOAD_IDLE_MS = 60_000;
export const DOWNLOAD_TOTAL_MS = 600_000;
const DAY_MS = 24 * 3600_000;
const REFRESH_AFTER_MS = 30 * DAY_MS;
const BATCH_MS = 25;

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isAbort = (e: unknown) => e instanceof Error && e.name === "AbortError";
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

function removeQuietly(file: string): void {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // gone already, or held open: the next start clears it
  }
}

// ---------------------------------------------------------------- list files and download times

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * When a list was downloaded: the time in `<list>.downloaded` when it holds an ISO 8601 UTC time no
 * later than now, else the list's own last-modified time.
 */
// @spec APT-DATA-018
export function readDownloadTime(listFile: string, now: Date = new Date()): Date {
  try {
    const text = fs.readFileSync(`${listFile}.downloaded`, "utf8").trim();
    const t = Date.parse(text);
    if (ISO_UTC.test(text) && Number.isFinite(t) && t <= now.getTime()) return new Date(t);
  } catch {
    // no time recorded
  }
  return fs.statSync(listFile).mtime;
}

/** Write `<list>.downloaded` by way of a temporary name. */
export function writeDownloadTime(listFile: string, time: Date): void {
  const file = `${listFile}.downloaded`;
  fs.writeFileSync(`${file}.partial`, `${time.toISOString()}\n`);
  fs.renameSync(`${file}.partial`, file);
}

/**
 * Put a complete list in place with its download time: the time written under its temporary name
 * first, then the two renames together, nothing awaited between them.
 */
function putInPlace(partial: string, listFile: string, time: Date): void {
  const timeFile = `${listFile}.downloaded`;
  fs.writeFileSync(`${timeFile}.partial`, `${time.toISOString()}\n`);
  fs.renameSync(partial, listFile);
  fs.renameSync(`${timeFile}.partial`, timeFile);
}

const tempNames = (dataFolder: string) =>
  LISTS.flatMap((l) => [`${LIST_NAMES[l]}.partial`, `${LIST_NAMES[l]}.downloaded.partial`]).map((n) => path.join(dataFolder, n));

/** The temporary list files and staging tables a download, seed or import left unfinished. */
// @spec APT-DATA-026
export function clearLeftovers(db: DatabaseSync, dataFolder: string): void {
  for (const file of tempNames(dataFolder)) removeQuietly(file);
  dropStaging(db);
}

// ---------------------------------------------------------------- downloads

export class DownloadFailed extends Error {}

/**
 * Download a list into `dest` (the caller's temporary name), with the server's User-Agent. Fails
 * after `idleMs` with no data or `totalMs` in all, naming the HTTP status when there is one; any
 * failure or abort deletes `dest`. An abort by `signal` throws its reason, not DownloadFailed.
 */
// @spec APT-DATA-019, APP-API-005
export async function downloadList(
  url: string,
  dest: string,
  o: { signal?: AbortSignal; idleMs?: number; totalMs?: number } = {},
): Promise<void> {
  const name = path.posix.basename(new URL(url).pathname);
  const idleMs = o.idleMs ?? DOWNLOAD_IDLE_MS;
  const totalMs = o.totalMs ?? DOWNLOAD_TOTAL_MS;
  o.signal?.throwIfAborted();
  const ac = new AbortController();
  let why: string | null = null;
  const giveUp = (reason: string) => {
    why ??= reason;
    ac.abort();
  };
  const overall = setTimeout(() => giveUp(`not finished within ${totalMs / 60_000} minutes`), totalMs);
  let idle = setTimeout(() => giveUp(`no data for ${idleMs / 1000} s`), idleMs);
  const stillArriving = () => {
    clearTimeout(idle);
    idle = setTimeout(() => giveUp(`no data for ${idleMs / 1000} s`), idleMs);
  };
  const outer = () => ac.abort(o.signal!.reason);
  o.signal?.addEventListener("abort", outer);
  let out: fs.promises.FileHandle | null = null;
  try {
    console.log(`[data] downloading ${url} ...`);
    const res = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal: ac.signal });
    if (!res.ok) throw new DownloadFailed(`download of ${name} failed: ${`HTTP ${res.status} ${res.statusText}`.trim()}`);
    out = await fs.promises.open(dest, "w");
    const body = res.body?.getReader();
    for (;;) {
      const chunk = await body?.read();
      if (!chunk || chunk.done) break;
      stillArriving();
      await out.write(chunk.value);
    }
    await out.close();
    out = null;
  } catch (e) {
    await out?.close().catch(() => {});
    removeQuietly(dest);
    if (o.signal?.aborted) throw o.signal.reason;
    if (why) throw new DownloadFailed(`download of ${name} failed: ${why}`);
    if (e instanceof DownloadFailed) throw e;
    const cause = e instanceof TypeError && e.cause instanceof Error ? e.cause : e;
    throw new DownloadFailed(`download of ${name} failed: ${messageOf(cause)}`);
  } finally {
    clearTimeout(overall);
    clearTimeout(idle);
    o.signal?.removeEventListener("abort", outer);
  }
}

// ---------------------------------------------------------------- CSV

/** RFC-4180 records read one at a time: quoted fields, doubled quotes, commas and newlines in quotes, CRLF or LF. */
class CsvReader {
  position = 0;
  constructor(private readonly text: string) {}

  /** The next record, or null at the end; blank lines are skipped. */
  next(): string[] | null {
    const t = this.text;
    const n = t.length;
    while (this.position < n) {
      let i = this.position;
      const row: string[] = [];
      for (;;) {
        let value: string;
        if (t[i] === '"') {
          value = "";
          i++;
          for (;;) {
            const q = t.indexOf('"', i);
            if (q < 0) {
              value += t.slice(i);
              i = n;
              break;
            }
            value += t.slice(i, q);
            if (t[q + 1] === '"') {
              value += '"';
              i = q + 2;
            } else {
              i = q + 1;
              break;
            }
          }
          const end = fieldEnd(t, i);
          value += t.slice(i, end);
          i = end;
        } else {
          const end = fieldEnd(t, i);
          value = t.slice(i, end);
          i = end;
        }
        row.push(value);
        if (i >= n) break;
        if (t[i] === ",") {
          i++;
          continue;
        }
        i += t[i] === "\r" && t[i + 1] === "\n" ? 2 : 1;
        break;
      }
      this.position = i;
      if (row.length > 1 || row[0] !== "") return row;
    }
    return null;
  }
}

function fieldEnd(t: string, from: number): number {
  let i = from;
  while (i < t.length) {
    const c = t.charCodeAt(i);
    if (c === 44 || c === 10 || c === 13) break;
    i++;
  }
  return i;
}

/**
 * A list file as text, read off the event loop and decoded a megabyte at a turn, so a list of tens
 * of megabytes never holds the server while it becomes a string.
 */
async function readText(file: string, signal?: AbortSignal): Promise<string> {
  const bytes = await fs.promises.readFile(file);
  const decoder = new TextDecoder("utf-8");
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 1 << 20) {
    parts.push(decoder.decode(bytes.subarray(i, i + (1 << 20)), { stream: true }));
    await nextTurn();
    signal?.throwIfAborted();
  }
  parts.push(decoder.decode());
  const text = parts.join("");
  // Strip a byte-order mark, as reading with "utf8" would keep it and a header match would miss it.
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** The non-blank records from `from` on, counted in turns of at most `budgetMs`. */
async function countRecords(t: string, from: number, budgetMs: number, signal?: AbortSignal): Promise<number> {
  let count = 0;
  let inQuotes = false;
  let content = false;
  let i = from;
  while (i < t.length) {
    const until = performance.now() + budgetMs;
    const stop = Math.min(t.length, i + 250_000);
    for (; i < stop; i++) {
      const c = t.charCodeAt(i);
      if (c === 34) {
        inQuotes = !inQuotes;
        content = true;
      } else if (!inQuotes && (c === 10 || c === 13)) {
        if (content) count++;
        content = false;
      } else {
        content = true;
      }
    }
    if (i < t.length && performance.now() >= until) {
      await nextTurn();
      signal?.throwIfAborted();
    }
  }
  if (content) count++;
  return count;
}

// ---------------------------------------------------------------- surfaces

export type SurfaceClass = "paved" | "grass" | "gravel" | "dirt" | "water" | "snow" | "unknown";

/** Collapse OurAirports' free-text surface codes ("ASPH-G", "TURF-F", "PIÇARRA"...) into a few classes. */
// @spec APT-DATA-012
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

// ---------------------------------------------------------------- staging and the swap

const AIRPORT_COLUMNS =
  "ident, type, name, lat, lon, elevation_ft, iso_country, iso_region, municipality, icao_code, iata_code, gps_code, local_code, wikipedia_link, home_link";
const RUNWAY_COLUMNS = "id, airport_ident, length_ft, width_ft, surface, surface_class, lighted, closed, le_ident, he_ident, le_heading, he_heading";

const STAGING: Record<ListName, { table: string; create: string }> = {
  airports: {
    table: "airports_staging",
    create: `CREATE TABLE airports_staging (
      ident TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL, lat REAL NOT NULL, lon REAL NOT NULL,
      elevation_ft INTEGER, iso_country TEXT, iso_region TEXT, municipality TEXT, icao_code TEXT, iata_code TEXT,
      gps_code TEXT, local_code TEXT, wikipedia_link TEXT, home_link TEXT)`,
  },
  runways: {
    table: "runways_staging",
    create: `CREATE TABLE runways_staging (
      id INTEGER PRIMARY KEY, airport_ident TEXT NOT NULL, length_ft INTEGER, width_ft INTEGER, surface TEXT,
      surface_class TEXT NOT NULL, lighted INTEGER NOT NULL DEFAULT 0, closed INTEGER NOT NULL DEFAULT 0,
      le_ident TEXT, he_ident TEXT, le_heading REAL, he_heading REAL)`,
  },
};

/** Drop both staging tables, if there are any. */
export function dropStaging(db: DatabaseSync): void {
  for (const list of LISTS) db.exec(`DROP TABLE IF EXISTS ${STAGING[list].table}`);
}

/** How one list's records become staging rows: the required columns found, and each record's insert. */
interface RowWriter {
  sql: string;
  /** Inserts the record, or skips it; true when inserted. */
  add(insert: StatementSync, r: string[]): boolean;
}

const optText = (v: string | undefined) => (v ? v : null);
const numeric = (v: string | undefined) => (v === undefined || v.trim() === "" ? NaN : Number(v));

// @spec APT-DATA-006
function airportWriter(col: (name: string) => number): RowWriter {
  const c = {
    ident: col("ident"), type: col("type"), name: col("name"),
    lat: col("latitude_deg"), lon: col("longitude_deg"), elev: col("elevation_ft"),
    country: col("iso_country"), region: col("iso_region"), muni: col("municipality"),
    icao: col("icao_code"), iata: col("iata_code"), gps: col("gps_code"), local: col("local_code"),
    wiki: col("wikipedia_link"), home: col("home_link"),
  };
  return {
    sql: `INSERT OR REPLACE INTO airports_staging (${AIRPORT_COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    add(insert, r) {
      if (r[c.type] === "closed") return false;
      const lat = numeric(r[c.lat]);
      const lon = numeric(r[c.lon]);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
      const elev = numeric(r[c.elev]);
      insert.run(
        r[c.ident] ?? "", r[c.type] ?? "", r[c.name] ?? "", lat, lon, Number.isFinite(elev) ? elev : null,
        optText(r[c.country]), optText(r[c.region]), optText(r[c.muni]),
        optText(r[c.icao]), optText(r[c.iata]), optText(r[c.gps]), optText(r[c.local]),
        optText(r[c.wiki]), optText(r[c.home]),
      );
      return true;
    },
  };
}

// @spec APT-DATA-010, APT-DATA-011, APT-DATA-012
function runwayWriter(col: (name: string) => number): RowWriter {
  const c = {
    id: col("id"), ident: col("airport_ident"), len: col("length_ft"), wid: col("width_ft"),
    surface: col("surface"), lighted: col("lighted"), closed: col("closed"),
    le: col("le_ident"), he: col("he_ident"), leHdg: col("le_heading_degT"), heHdg: col("he_heading_degT"),
  };
  const num = (s: string | undefined) => {
    const n = numeric(s);
    return !Number.isFinite(n) || n <= 0 ? null : Math.round(n);
  };
  /** True heading from the CSV, else derived from the runway number ("16L" -> 160). */
  const heading = (deg: string, ident: string): number | null => {
    const n = numeric(deg);
    if (Number.isFinite(n)) return ((n % 360) + 360) % 360;
    const m = /^(\d{2})[LRC]?$/.exec(ident.trim());
    return m ? (Number(m[1]) * 10) % 360 : null;
  };
  return {
    sql: `INSERT OR REPLACE INTO runways_staging (${RUNWAY_COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    add(insert, r) {
      const ident = r[c.ident];
      if (!ident) return false;
      const le = r[c.le] ?? "";
      const he = r[c.he] ?? "";
      const leH = heading(r[c.leHdg] ?? "", le);
      const heH = heading(r[c.heHdg] ?? "", he) ?? (leH != null ? (leH + 180) % 360 : null);
      insert.run(
        Number(r[c.id]), ident, num(r[c.len]), num(r[c.wid]), optText(r[c.surface]), surfaceClass(r[c.surface] ?? ""),
        r[c.lighted] === "1" ? 1 : 0, r[c.closed] === "1" ? 1 : 0, le || null, he || null, leH, heH,
      );
      return true;
    },
  };
}

/**
 * Read a list into its staging table in batches, each one transaction holding the server for about
 * `batchMs`, yielding between them, while the live tables stay as they were. The header is checked
 * before anything is staged. `onProgress(rows, total)` reports the records read so far out of the
 * list's records. Any failure or abort drops the staging table; returns the rows staged.
 */
// @spec APT-DATA-023, APT-DATA-014, APT-DATA-025
export async function stageList(
  db: DatabaseSync,
  list: ListName,
  file: string,
  o: { signal?: AbortSignal; onProgress?(rows: number, total: number): void; batchMs?: number } = {},
): Promise<number> {
  const budget = o.batchMs ?? BATCH_MS;
  const text = await readText(file, o.signal);
  o.signal?.throwIfAborted();
  const reader = new CsvReader(text);
  const header = reader.next() ?? [];
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`${file}: missing column ${name}`);
    return i;
  };
  const writer = list === "airports" ? airportWriter(col) : runwayWriter(col);
  await nextTurn();
  const total = await countRecords(text, reader.position, budget, o.signal);
  o.signal?.throwIfAborted();

  const { table, create } = STAGING[list];
  db.exec(`DROP TABLE IF EXISTS ${table}`);
  db.exec(create);
  try {
    const insert = db.prepare(writer.sql);
    let rows = 0;
    let staged = 0;
    o.onProgress?.(0, total);
    for (;;) {
      await nextTurn();
      o.signal?.throwIfAborted();
      const until = performance.now() + budget;
      let ended = false;
      db.exec("BEGIN");
      try {
        for (let k = 0; ; k++) {
          if ((k & 127) === 127 && performance.now() >= until) break;
          const r = reader.next();
          if (!r) {
            ended = true;
            break;
          }
          rows++;
          if (writer.add(insert, r)) staged++;
        }
        db.exec("COMMIT");
      } catch (e) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // already rolled back
        }
        throw e;
      }
      if (ended) break;
      o.onProgress?.(rows, Math.max(rows, total));
    }
    const end = Math.max(rows, total);
    o.onProgress?.(end, end);
    return staged;
  } catch (e) {
    db.exec(`DROP TABLE IF EXISTS ${table}`);
    throw e;
  }
}

/**
 * Replace the live data with the staged lists in one short transaction, airports before runways.
 * An airport a hop references that the new list lacks is kept, flagged as no longer listed, with its
 * runways; the runway summary is rebuilt. Returns the rows each list put in.
 */
// @spec APT-DATA-023, APT-DATA-006, APT-DATA-007, APT-DATA-013
export function swapIn(db: DatabaseSync, lists: ListName[]): { airports?: number; runways?: number } {
  const out: { airports?: number; runways?: number } = {};
  const staged = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  db.exec("BEGIN");
  try {
    if (lists.includes("airports")) {
      out.airports = staged("airports_staging");
      // The kept airports set aside; the table emptied in one step and filled with its indexes off,
      // which are then built again in one pass each (far quicker than row by row).
      const indexes = db.prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'airports' AND sql IS NOT NULL`).all() as { name: string; sql: string }[];
      db.exec(`
        CREATE TEMP TABLE airports_kept AS
          SELECT * FROM airports
          WHERE ident IN (SELECT origin FROM hops UNION SELECT dest FROM hops)
            AND ident NOT IN (SELECT ident FROM airports_staging);
        ${indexes.map((i) => `DROP INDEX "${i.name}";`).join(" ")}
        DELETE FROM airports;
        INSERT INTO airports (${AIRPORT_COLUMNS}, unlisted) SELECT ${AIRPORT_COLUMNS}, 0 FROM airports_staging;
        INSERT INTO airports (${AIRPORT_COLUMNS}, unlisted) SELECT ${AIRPORT_COLUMNS}, 1 FROM temp.airports_kept;
        DROP TABLE temp.airports_kept;
        DROP TABLE airports_staging;
        ${indexes.map((i) => `${i.sql};`).join(" ")}`);
    }
    if (lists.includes("runways")) {
      out.runways = staged("runways_staging");
      db.exec(`
        DELETE FROM runways WHERE airport_ident NOT IN (SELECT ident FROM airports WHERE unlisted = 1);
        INSERT OR REPLACE INTO runways (${RUNWAY_COLUMNS})
          SELECT ${RUNWAY_COLUMNS} FROM runways_staging
          WHERE airport_ident NOT IN (SELECT ident FROM airports WHERE unlisted = 1);
        DROP TABLE runways_staging;
        DELETE FROM airport_rwy;
        INSERT INTO airport_rwy (ident, max_length_ft, max_width_ft, runway_count, surfaces, paved, lighted, headings)
        SELECT airport_ident, MAX(length_ft), MAX(width_ft), COUNT(*), GROUP_CONCAT(DISTINCT surface_class),
               MAX(surface_class = 'paved'), MAX(lighted),
               (SELECT GROUP_CONCAT(DISTINCT CAST(ROUND(le_heading) AS INTEGER))
                  FROM runways r2 WHERE r2.airport_ident = runways.airport_ident AND r2.closed = 0 AND r2.le_heading IS NOT NULL)
        FROM runways WHERE closed = 0 GROUP BY airport_ident;`);
    }
    db.exec("COMMIT");
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // already rolled back
    }
    throw e;
  }
  return out;
}

// ---------------------------------------------------------------- the server's airport work

/** Whether the pilot is in the sim, and a notice whenever that may have changed (app-shell, APP-SRV-012). */
export interface InSim {
  now(): boolean;
  onChange(listener: () => void): () => void;
}

export class AirportsBusy extends Error {
  readonly status = 409;
  constructor() {
    super("airport data is already being imported");
  }
}

export interface AirportWorkOptions {
  db: DatabaseSync;
  dataFolder: string;
  programFolder: string | null;
  /** The status's airport-data report. */
  report(r: AirportDataReport): void;
  /** Called after every swap: the status's counts. */
  counts(): void;
  now?: () => Date;
  /** The daily timer; returns its cancel. */
  every?: (fn: () => void, ms: number) => () => void;
  download?: { idleMs?: number; totalMs?: number };
  batchMs?: number;
}

type HeldJob = "prepare" | "refresh";

const everyDefault = (fn: () => void, ms: number) => {
  const t = setInterval(fn, ms);
  t.unref();
  return () => clearInterval(t);
};

/**
 * The server's airport work, one job at a time: preparation at start, the daily checks (a failed
 * preparation prepared again, else the monthly refresh), both held while the pilot is in the sim,
 * and requested re-imports. `stop()` ends it at shutdown.
 */
export class AirportWork {
  private readonly now: () => Date;
  private downloads = false;
  private lastFailed = false;
  private stopped = false;
  private current: { job: HeldJob | "start" | "reimport"; ac: AbortController; settled: Promise<unknown> } | null = null;
  /** A job held until the pilot leaves the sim. */
  private waiting: HeldJob | null = null;
  private inSim: InSim | null = null;
  private unlisten: (() => void) | null = null;
  private cancelEvery: (() => void) | null = null;

  constructor(private readonly o: AirportWorkOptions) {
    this.now = o.now ?? (() => new Date());
  }

  private file(list: ListName) {
    return path.join(this.o.dataFolder, LIST_NAMES[list]);
  }

  /** Preparation at start: leftovers cleared first. Rejects with the failure, after reporting it. */
  // @spec APT-DATA-001, APT-DATA-002, APT-DATA-017, APT-DATA-020, APT-DATA-021, APT-DATA-022, APT-DATA-026, APP-API-010
  async prepareAtStart(o: { downloads: boolean }): Promise<void> {
    if (this.current || this.waiting) throw new AirportsBusy();
    this.downloads = o.downloads;
    clearLeftovers(this.o.db, this.o.dataFolder);
    await this.run("start", (signal) => this.prepare(signal));
  }

  /** The first check now (as preparation at start ends), then one every 24 hours. */
  // @spec APT-DATA-003, APT-DATA-004, APT-DATA-022
  startChecks(inSim: InSim): void {
    if (this.stopped) return;
    this.inSim = inSim;
    this.unlisten = inSim.onChange(() => this.simChanged());
    this.cancelEvery = (this.o.every ?? everyDefault)(() => this.check(), DAY_MS);
    this.check(true);
  }

  /** A daily check: nothing while busy; a failed preparation prepared again, except at the first check; else a refresh when due. */
  check(first = false): void {
    if (this.stopped || this.busy()) return;
    if (this.lastFailed) {
      if (!first) this.hold("prepare");
      return;
    }
    if (this.downloads && this.refreshDue()) this.hold("refresh");
  }

  busy(): boolean {
    return this.current !== null || this.waiting !== null;
  }

  /** A re-import asked for: both lists downloaded first with `download`, whatever airport downloads are; refused while busy. */
  // @spec APT-DATA-016, APT-DATA-020, APT-DATA-024
  async reimport(o: { download: boolean }): Promise<{ airports: number; runways: number }> {
    if (this.stopped || this.busy()) throw new AirportsBusy();
    return this.run("reimport", (signal) => importBoth(this.ctx(signal), { download: () => o.download }));
  }

  /** At shutdown: no more checks, the job under way stopped, settled once its temporary files and staging are gone. */
  // @spec APT-DATA-025
  async stop(): Promise<void> {
    this.stopped = true;
    this.cancelEvery?.();
    this.unlisten?.();
    this.cancelEvery = this.unlisten = null;
    this.waiting = null;
    const current = this.current;
    if (current) {
      current.ac.abort();
      await current.settled.catch(() => {});
    }
  }

  private ctx(signal: AbortSignal): ImportContext {
    return { db: this.o.db, dataFolder: this.o.dataFolder, now: this.now, signal, download: this.o.download, batchMs: this.o.batchMs, counts: this.o.counts };
  }

  private async run<T>(job: HeldJob | "start" | "reimport", fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const ac = new AbortController();
    const p = fn(ac.signal);
    const entry = { job, ac, settled: p };
    this.current = entry;
    try {
      return await p;
    } finally {
      if (this.current === entry) this.current = null;
      this.startWaiting();
    }
  }

  private refreshDue(): boolean {
    const now = this.now();
    return LISTS.some((list) => {
      const file = this.file(list);
      if (!fs.existsSync(file)) return true;
      return now.getTime() - readDownloadTime(file, now).getTime() > REFRESH_AFTER_MS;
    });
  }

  /** Start a job now, or hold it while the pilot is in the sim. */
  private hold(job: HeldJob): void {
    if (this.inSim?.now()) {
      if (this.waiting !== job) console.log(`[data] airport ${job === "refresh" ? "refresh" : "preparation"} waits until the pilot leaves the sim`);
      this.waiting = job;
      return;
    }
    this.start(job);
  }

  private start(job: HeldJob): void {
    this.waiting = null;
    const done = this.run(job, (signal) => (job === "refresh" ? this.refresh(signal) : this.prepare(signal)));
    done.catch((e) => {
      if (isAbort(e)) return;
      console.error(`[data] airport preparation failed: ${messageOf(e)}`);
    });
  }

  private startWaiting(): void {
    if (!this.stopped && !this.current && this.waiting && !this.inSim?.now()) this.start(this.waiting);
  }

  /** The pilot came into the sim (a held job under way stops before it replaces anything) or left it (a held job starts). */
  private simChanged(): void {
    if (this.stopped || !this.inSim) return;
    if (this.inSim.now()) {
      const c = this.current;
      if (c && (c.job === "refresh" || c.job === "prepare")) {
        console.log(`[data] the pilot is in the sim: airport ${c.job === "refresh" ? "refresh" : "preparation"} stopped, to start again later`);
        this.waiting = c.job;
        c.ac.abort();
      }
    } else {
      this.startWaiting();
    }
  }

  /** A preparation: seed, download what an import needs, import into empty tables, reporting each step. */
  private async prepare(signal: AbortSignal): Promise<void> {
    const { db } = this.o;
    const temps: string[] = [];
    try {
      await this.seed(signal, temps);
      if (count(db, "airports") === 0) await this.prepareList("airports", signal, temps);
      if (count(db, "runways") === 0 || count(db, "runways WHERE le_heading IS NOT NULL") === 0) await this.prepareList("runways", signal, temps);
      this.lastFailed = false;
      this.o.report({ state: "done" });
      console.log("[data] airport data ready");
    } catch (e) {
      for (const t of temps) removeQuietly(t);
      dropStaging(db);
      if (isAbort(e)) throw e;
      this.lastFailed = true;
      this.o.report({ state: "failed", error: messageOf(e) });
      throw e;
    }
  }

  /** Each list the data folder lacks and the program folder holds, copied in with the program's download time. */
  // @spec APT-DATA-017, APT-DATA-018
  private async seed(signal: AbortSignal, temps: string[]): Promise<void> {
    const program = this.o.programFolder;
    if (!program) return;
    let reported = false;
    for (const list of LISTS) {
      const dest = this.file(list);
      const source = path.join(program, LIST_NAMES[list]);
      if (fs.existsSync(dest) || !fs.existsSync(source)) continue;
      if (!reported) {
        this.o.report({ state: "seeding" });
        reported = true;
      }
      const partial = `${dest}.partial`;
      temps.push(partial);
      console.log(`[data] seeding ${LIST_NAMES[list]} from ${program}`);
      await fs.promises.copyFile(source, partial);
      signal.throwIfAborted();
      putInPlace(partial, dest, readDownloadTime(source, this.now()));
    }
  }

  private async prepareList(list: ListName, signal: AbortSignal, temps: string[]): Promise<void> {
    const file = this.file(list);
    if (!fs.existsSync(file)) {
      if (!this.downloads) throw new Error(`${LIST_NAMES[list]} is missing and airport downloads are off`);
      this.o.report({ state: "downloading", list });
      const partial = `${file}.partial`;
      temps.push(partial);
      await downloadList(URLS[list], partial, { signal, ...this.o.download });
      putInPlace(partial, file, this.now());
    }
    console.log(`[data] importing ${list} ...`);
    await stageList(this.o.db, list, file, {
      signal,
      batchMs: this.o.batchMs,
      onProgress: (rows, total) => this.o.report({ state: "importing", list, rows, total }),
    });
    signal.throwIfAborted();
    const n = swapIn(this.o.db, [list])[list];
    this.o.counts();
    console.log(`[data] imported ${n} ${list}`);
  }

  /** Both lists downloaded under temporary names and imported from there; put in place only once the swap is done. */
  // @spec APT-DATA-003, APT-DATA-005
  private async refresh(signal: AbortSignal): Promise<void> {
    const partial = (list: ListName) => `${this.file(list)}.partial`;
    try {
      const times = {} as Record<ListName, Date>;
      for (const list of LISTS) {
        await downloadList(URLS[list], partial(list), { signal, ...this.o.download });
        times[list] = this.now();
      }
      for (const list of LISTS) await stageList(this.o.db, list, partial(list), { signal, batchMs: this.o.batchMs });
      signal.throwIfAborted();
      const n = swapIn(this.o.db, LISTS);
      this.o.counts();
      for (const list of LISTS) putInPlace(partial(list), this.file(list), times[list]);
      console.log(`[data] airport lists refreshed: ${n.airports} airports, ${n.runways} runways`);
    } catch (e) {
      for (const list of LISTS) removeQuietly(partial(list));
      dropStaging(this.o.db);
      if (isAbort(e)) throw e;
      console.error(`[data] airport refresh failed: ${messageOf(e)}`);
    }
  }
}

const count = (db: DatabaseSync, from: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${from}`).get() as { n: number }).n;

interface ImportContext {
  db: DatabaseSync;
  dataFolder: string;
  now: () => Date;
  signal?: AbortSignal;
  download?: { idleMs?: number; totalMs?: number };
  batchMs?: number;
  counts?: () => void;
}

/**
 * A requested re-import: each list `download` names downloaded and put in place with its time, then
 * both staged from the data folder and swapped in together.
 */
async function importBoth(c: ImportContext, o: { download: (list: ListName) => boolean }): Promise<{ airports: number; runways: number }> {
  const file = (list: ListName) => path.join(c.dataFolder, LIST_NAMES[list]);
  try {
    for (const list of LISTS) {
      if (!o.download(list)) continue;
      await downloadList(URLS[list], `${file(list)}.partial`, { signal: c.signal, ...c.download });
      putInPlace(`${file(list)}.partial`, file(list), c.now());
    }
    for (const list of LISTS) await stageList(c.db, list, file(list), { signal: c.signal, batchMs: c.batchMs });
    c.signal?.throwIfAborted();
    const n = swapIn(c.db, LISTS);
    c.counts?.();
    return { airports: n.airports ?? 0, runways: n.runways ?? 0 };
  } catch (e) {
    for (const list of LISTS) removeQuietly(`${file(list)}.partial`);
    dropStaging(c.db);
    throw e;
  }
}

/**
 * `npm run import-airports`: each list downloaded first when missing (both with `fresh`), then both
 * imported. Runs in a process of its own, outside any server's AirportWork.
 */
// @spec APT-DATA-015
export function reimportLists(db: DatabaseSync, dataFolder: string, o: { fresh: boolean }): Promise<{ airports: number; runways: number }> {
  return importBoth(
    { db, dataFolder, now: () => new Date() },
    { download: (list) => o.fresh || !fs.existsSync(path.join(dataFolder, LIST_NAMES[list])) },
  );
}
