/**
 * Airport lists for the airport-data tests: CSV text in OurAirports' shape, folders and databases of
 * their own in the run folder, and fetch answers that stream, stall or trickle. Nothing here
 * imports app code that opens a database (schema.ts opens none).
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { inject } from "vitest";
import { applySchema } from "../../src/server/schema.ts";
import { FIXTURES_DIR } from "./run-folder.ts";

export const AIRPORTS_HEADER =
  '"id","ident","type","name","latitude_deg","longitude_deg","elevation_ft","continent","iso_country","iso_region","municipality","scheduled_service","icao_code","iata_code","gps_code","local_code","home_link","wikipedia_link","keywords"';
export const RUNWAYS_HEADER =
  '"id","airport_ref","airport_ident","length_ft","width_ft","surface","lighted","closed","le_ident","le_latitude_deg","le_longitude_deg","le_elevation_ft","le_heading_degT","le_displaced_threshold_ft","he_ident","he_latitude_deg","he_longitude_deg","he_elevation_ft","he_heading_degT","he_displaced_threshold_ft"';

export interface AirportLine {
  ident: string;
  type?: string;
  name?: string;
  lat?: number;
  lon?: number;
}

let nextId = 900_000;

/** One airports.csv record. */
export function airportLine(a: AirportLine): string {
  const name = a.name ?? `${a.ident} Field`;
  return `${nextId++},"${a.ident}","${a.type ?? "small_airport"}","${name}",${a.lat ?? 41},${a.lon ?? -71},100,"NA","US","US-RI","Testville","no","${a.ident}",,"${a.ident}",,,,`;
}

/** One runways.csv record; `le` a runway number such as "05". */
export function runwayLine(airport: string, le = "05", he = "23", lengthFt = 4000): string {
  return `${nextId++},1,"${airport}",${lengthFt},100,"ASPH",1,0,"${le}",,,,,,"${he}",,,,,`;
}

export const airportsCsv = (lines: AirportLine[]) => [AIRPORTS_HEADER, ...lines.map(airportLine)].join("\n") + "\n";
export const runwaysCsv = (lines: [string, string?, string?][]) =>
  [RUNWAYS_HEADER, ...lines.map(([a, le, he]) => runwayLine(a, le, he))].join("\n") + "\n";

/** `n` small airports ZZ000000…, spread over a few degrees; with the header. */
export function bigAirportsCsv(n: number): string {
  const out: string[] = [AIRPORTS_HEADER];
  for (let i = 0; i < n; i++) {
    const ident = `ZZ${String(i).padStart(6, "0")}`;
    out.push(airportLine({ ident, lat: 30 + (i % 1000) / 100, lon: -100 + Math.floor(i / 1000) / 100 }));
  }
  return out.join("\n") + "\n";
}

export const fixtureText = (list: "airports" | "runways") => fs.readFileSync(path.join(FIXTURES_DIR, `${list}.csv`), "utf8");

/** A new, empty folder in the run folder. */
export function emptyFolder(kind = "lists-"): string {
  return fs.mkdtempSync(path.join(inject("runDir"), kind));
}

/** A database of its own in `folder`, its schema current; the caller closes it. */
export function scratchDb(folder: string): DatabaseSync {
  const db = new DatabaseSync(path.join(folder, "career.db"));
  db.exec("PRAGMA journal_mode = WAL");
  applySchema(db);
  return db;
}

export const countOf = (db: DatabaseSync, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
export const tablesOf = (db: DatabaseSync) =>
  (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((r) => r.name);

/** A hop between two idents, with the fleet aircraft it needs. */
export function addHop(db: DatabaseSync, origin: string, dest: string): void {
  let id = (db.prepare(`SELECT id FROM aircraft LIMIT 1`).get() as { id: number } | undefined)?.id;
  if (id === undefined) id = Number(db.prepare(`INSERT INTO aircraft (name) VALUES ('Test Cub')`).run().lastInsertRowid);
  const seq = countOf(db, "hops") + 1;
  db.prepare(`INSERT INTO hops (aircraft_id, seq, origin, dest, notes) VALUES (?, ?, ?, ?, '')`).run(id, seq, origin, dest);
}

/** The temporary names an airport-data step writes, by contract. */
export const TEMP_NAMES = ["airports.csv.partial", "runways.csv.partial", "airports.csv.downloaded.partial", "runways.csv.downloaded.partial"];
export const leftoverFiles = (folder: string) => fs.readdirSync(folder).filter((n) => n.endsWith(".partial"));

const signalOf = (init?: RequestInit) => init?.signal ?? undefined;

/** A whole list as an answer. */
export function listResponse(text: string, init?: RequestInit): Response {
  return streamResponse(init, (c) => {
    c.enqueue(new TextEncoder().encode(text));
    c.close();
  });
}

/**
 * An answer whose body the test drives: `start` gets the stream's controller. The body errors with
 * the request's abort reason when its signal aborts, as a real fetch's does.
 */
export function streamResponse(init: RequestInit | undefined, start: (c: ReadableStreamDefaultController<Uint8Array>) => void, status = 200): Response {
  const signal = signalOf(init);
  if (signal?.aborted) throw signal.reason;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      signal?.addEventListener("abort", () => {
        try {
          c.error(signal.reason);
        } catch {
          // already closed
        }
      });
      start(c);
    },
  });
  return new Response(body, { status, headers: { "content-type": "text/csv" } });
}

/** A first chunk of the list, then nothing more: a stalled connection. */
export const stalledResponse = (init?: RequestInit) =>
  streamResponse(init, (c) => c.enqueue(new TextEncoder().encode(`${AIRPORTS_HEADER}\n`)));

/** A byte every `everyMs`, never finishing: a trickling connection. */
export function tricklingResponse(init: RequestInit | undefined, everyMs: number): Response {
  let timer: NodeJS.Timeout | undefined;
  const res = streamResponse(init, (c) => {
    timer = setInterval(() => {
      try {
        c.enqueue(new TextEncoder().encode("x"));
      } catch {
        clearInterval(timer);
      }
    }, everyMs);
  });
  signalOf(init)?.addEventListener("abort", () => clearInterval(timer));
  return res;
}

/**
 * An answer held until the test releases it with the whole list, or until the request is aborted:
 * `held.answer` is the reply for answerFetch, `held.asked` resolves when the request comes in.
 */
export function heldAnswer(text: string) {
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  let asked!: () => void;
  const askedP = new Promise<void>((r) => (asked = r));
  let requests = 0;
  return {
    get requests() {
      return requests;
    },
    asked: askedP,
    release,
    answer: (_url: URL, init?: RequestInit) => {
      requests++;
      asked();
      return streamResponse(init, (c) => {
        void released.then(() => {
          try {
            c.enqueue(new TextEncoder().encode(text));
            c.close();
          } catch {
            // aborted meanwhile
          }
        });
      });
    },
  };
}

/** The user-agent a request carried. */
export const userAgentOf = (init?: RequestInit) => new Headers(init?.headers).get("user-agent");
