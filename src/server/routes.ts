import { Router, type Request, type Response, type NextFunction } from "express";
import fs from "node:fs";
import path from "node:path";
import { db, IMAGES_DIR, airportCount, runwayCount } from "./db.ts";
import {
  AIRPORT_TYPES,
  attachRunways,
  downloadAirportsCsv,
  downloadRunwaysCsv,
  findAirport,
  importAirportsCsv,
  importRunwaysCsv,
  latestMetar,
  latestMetars,
  planCandidates,
  searchAirports,
  wikiSummary,
  type AirportFull,
} from "./airports.ts";
import { simbriefAircraftTypes } from "./simbrief.ts";
import { currentHazards } from "./hazards.ts";
import { terrainAlong } from "./terrain.ts";
import { blockMinutes, maxRangeNm, profileFor } from "./performance.ts";
import { tracker } from "./tracker.ts";
import { fetchLatestOfp, type BriefingSummary, type FetchedOfp } from "./ofp.ts";

export const api = Router();

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

type Handler = (req: Request, res: Response) => unknown | Promise<unknown>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(fn(req, res)).catch(next);

const idParam = (req: Request): number => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, "invalid id");
  return id;
};

const optStr = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

const optNum = (v: unknown, label: string): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new HttpError(400, `${label}: expected a number`);
  return n;
};

const optInt = (v: unknown, label = "value"): number | null => {
  const n = optNum(v, label);
  return n === null ? null : Math.round(n);
};

// ---------- airports ----------

api.get("/airports/search", wrap((req, res) => {
  const q = String(req.query.q ?? "");
  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 12) || 12));
  res.json(searchAirports(q, limit));
}));

api.get("/airports/:code", wrap((req, res) => {
  const a = findAirport(String(req.params.code));
  if (!a) throw new HttpError(404, `airport not found: ${req.params.code}`);
  res.json(attachRunways([a])[0]);
}));

/** Wikipedia summary (title, extract, lead image) for an airport; 404 when it has no article. */
api.get("/airports/:code/wiki", wrap(async (req, res) => {
  const a = findAirport(String(req.params.code));
  if (!a) throw new HttpError(404, `airport not found: ${req.params.code}`);
  const w = await wikiSummary(a);
  if (!w) throw new HttpError(404, "no Wikipedia article for this airport");
  res.json(w);
}));

/** Latest METARs for many stations: GET /api/metars?ids=KBOS,KPIT,... (up to 500). Unreported stations map to null. */
api.get("/metars", wrap(async (req, res) => {
  const ids = String(req.query.ids ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z0-9]{4}$/.test(s));
  if (ids.length === 0) throw new HttpError(400, "ids must list 4-character ICAO codes");
  if (ids.length > 500) throw new HttpError(400, "at most 500 ids per request");
  res.json({ metars: await latestMetars(ids), fetched_at: new Date().toISOString() });
}));

/** Latest METAR for an ICAO station via aviationweather.gov; 404 when none is reported. */
api.get("/metar/:icao", wrap(async (req, res) => {
  const icao = String(req.params.icao).trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(icao)) throw new HttpError(400, "METAR lookups need a 4-character ICAO code");
  const m = await latestMetar(icao);
  if (!m) throw new HttpError(404, `no current METAR for ${icao}`);
  res.json(m);
}));

api.post("/airports/reimport", wrap(async (req, res) => {
  if (req.query.download === "1") {
    await downloadAirportsCsv();
    await downloadRunwaysCsv();
  }
  const airports = importAirportsCsv();
  const runways = importRunwaysCsv();
  res.json({ airports, runways });
}));

// ---------- aircraft ----------

export interface AircraftRow {
  id: number;
  name: string;
  livery: string;
  color: string;
  icon: string;
  notes: string;
  visible: number;
  cruise_kts: number | null;
  min_runway_ft: number | null;
  /** ICAO type designator SimBrief knows, e.g. "AEST", "TBM8", "C172". */
  simbrief_type: string | null;
  /** Service ceiling, feet. */
  ceiling_ft: number | null;
  /** 1 when pressurised or carrying oxygen (may cruise above 12,000 ft). */
  oxygen: number;
  /** Maximum demonstrated crosswind, knots. */
  max_xwind_kts: number | null;
  /** 0 for VFR-only aircraft (IFR/LIFR destinations are flagged). */
  ifr_capable: number;
  /** Block-time model inputs; null means use the light-piston defaults. */
  cruise_alt_ft: number | null;
  climb_fpm: number | null;
  climb_kts: number | null;
  descent_fpm: number | null;
  overhead_min: number | null;
  /** Sim `TITLE` / `LIVERY NAME` this row is bound to, so the live tracker can pick it automatically. */
  sim_title: string | null;
  sim_livery: string | null;
  created_at: string;
}

/** Pattern altitude margin: an airport must sit at least this far below the ceiling. */
const CEILING_MARGIN_FT = 2000;
/** Above this cruising altitude the aircraft needs oxygen or pressurisation. */
const OXYGEN_ALTITUDE_FT = 12000;

const aircraftList = db.prepare(`SELECT * FROM aircraft ORDER BY name, livery, id`);
const aircraftGet = db.prepare(`SELECT * FROM aircraft WHERE id = ?`);

function requireAircraft(id: number): AircraftRow {
  const a = aircraftGet.get(id) as unknown as AircraftRow | undefined;
  if (!a) throw new HttpError(404, `aircraft ${id} not found`);
  return a;
}

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function cruiseKts(v: unknown): number | null {
  const n = optNum(v, "cruise speed");
  if (n !== null && (n <= 0 || n > 2000)) throw new HttpError(400, "cruise speed must be between 1 and 2000 knots");
  return n;
}

function minRunwayFt(v: unknown): number | null {
  const n = optInt(v, "minimum runway");
  if (n !== null && (n < 0 || n > 30000)) throw new HttpError(400, "minimum runway must be between 0 and 30000 ft");
  return n === 0 ? null : n;
}

function simbriefType(v: unknown): string | null {
  const s = optStr(v)?.toUpperCase() ?? null;
  if (s !== null && !/^[A-Z0-9]{2,6}$/.test(s)) throw new HttpError(400, "SimBrief type must be an ICAO designator like C172 or TBM8");
  return s;
}

function ceilingFt(v: unknown): number | null {
  const n = optInt(v, "service ceiling");
  if (n !== null && (n < 0 || n > 100000)) throw new HttpError(400, "service ceiling must be between 0 and 100000 ft");
  return n === 0 ? null : n;
}

function maxXwind(v: unknown): number | null {
  const n = optInt(v, "max crosswind");
  if (n !== null && (n < 0 || n > 100)) throw new HttpError(400, "max crosswind must be between 0 and 100 kt");
  return n === 0 ? null : n;
}

const bool = (v: unknown, fallback: number): number => (v === undefined ? fallback : v ? 1 : 0);

/** Positive integer within [lo, hi], or null when blank/zero. */
function perfInt(v: unknown, label: string, lo: number, hi: number): number | null {
  const n = optInt(v, label);
  if (n === null || n === 0) return null;
  if (n < lo || n > hi) throw new HttpError(400, `${label} must be between ${lo} and ${hi}`);
  return n;
}
const PERF_FIELDS = [
  ["cruise_alt_ft", "cruise altitude", 500, 60000],
  ["climb_fpm", "climb rate", 50, 10000],
  ["climb_kts", "climb speed", 20, 600],
  ["descent_fpm", "descent rate", 50, 10000],
  ["overhead_min", "taxi/approach overhead", 1, 120],
] as const;

/** Highest field elevation this aircraft can operate from, with the limiting reason. */
function maxFieldElevation(a: AircraftRow): { max_elevation_ft: number | null; elevation_reason: string | null } {
  let max: number | null = null;
  let reason: string | null = null;
  if (a.ceiling_ft != null) {
    max = a.ceiling_ft - CEILING_MARGIN_FT;
    reason = `service ceiling ${a.ceiling_ft.toLocaleString()} ft minus ${CEILING_MARGIN_FT.toLocaleString()} ft pattern margin`;
  }
  if (!a.oxygen) {
    const lim = OXYGEN_ALTITUDE_FT - CEILING_MARGIN_FT;
    if (max === null || lim < max) {
      max = lim;
      reason = `no oxygen/pressurisation: fields above ${lim.toLocaleString()} ft put the pattern over ${OXYGEN_ALTITUDE_FT.toLocaleString()} ft`;
    }
  }
  return { max_elevation_ft: max, elevation_reason: reason };
}

api.get("/aircraft", wrap((_req, res) => res.json(aircraftList.all())));

api.post("/aircraft", wrap((req, res) => {
  const b = req.body ?? {};
  const name = optStr(b.name);
  if (!name) throw new HttpError(400, "name is required");
  const color = optStr(b.color) ?? "#ff6b35";
  if (!COLOR_RE.test(color)) throw new HttpError(400, "color must be #rrggbb");
  const r = db
    .prepare(`INSERT INTO aircraft
      (name, livery, color, icon, notes, cruise_kts, min_runway_ft, simbrief_type, ceiling_ft, oxygen, max_xwind_kts, ifr_capable,
       cruise_alt_ft, climb_fpm, climb_kts, descent_fpm, overhead_min, sim_title, sim_livery)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(
      name, optStr(b.livery) ?? "", color, optStr(b.icon) ?? "builtin:twin-piston", optStr(b.notes) ?? "",
      cruiseKts(b.cruise_kts), minRunwayFt(b.min_runway_ft), simbriefType(b.simbrief_type),
      ceilingFt(b.ceiling_ft), bool(b.oxygen, 0), maxXwind(b.max_xwind_kts), bool(b.ifr_capable, 1),
      ...PERF_FIELDS.map(([k, label, lo, hi]) => perfInt(b[k], label, lo, hi)),
      optStr(b.sim_title), optStr(b.sim_livery),
    );
  res.status(201).json(requireAircraft(Number(r.lastInsertRowid)));
}));

api.put("/aircraft/:id", wrap((req, res) => {
  const id = idParam(req);
  const cur = requireAircraft(id);
  const b = req.body ?? {};
  const name = b.name === undefined ? cur.name : optStr(b.name);
  if (!name) throw new HttpError(400, "name is required");
  const color = b.color === undefined ? cur.color : optStr(b.color) ?? cur.color;
  if (!COLOR_RE.test(color)) throw new HttpError(400, "color must be #rrggbb");
  db.prepare(`UPDATE aircraft SET name=?, livery=?, color=?, icon=?, notes=?, visible=?, cruise_kts=?, min_runway_ft=?, simbrief_type=?,
                ceiling_ft=?, oxygen=?, max_xwind_kts=?, ifr_capable=?,
                cruise_alt_ft=?, climb_fpm=?, climb_kts=?, descent_fpm=?, overhead_min=?, sim_title=?, sim_livery=? WHERE id=?`).run(
    name,
    b.livery === undefined ? cur.livery : optStr(b.livery) ?? "",
    color,
    b.icon === undefined ? cur.icon : optStr(b.icon) ?? "builtin:twin-piston",
    b.notes === undefined ? cur.notes : optStr(b.notes) ?? "",
    b.visible === undefined ? cur.visible : b.visible ? 1 : 0,
    b.cruise_kts === undefined ? cur.cruise_kts : cruiseKts(b.cruise_kts),
    b.min_runway_ft === undefined ? cur.min_runway_ft : minRunwayFt(b.min_runway_ft),
    b.simbrief_type === undefined ? cur.simbrief_type : simbriefType(b.simbrief_type),
    b.ceiling_ft === undefined ? cur.ceiling_ft : ceilingFt(b.ceiling_ft),
    bool(b.oxygen, cur.oxygen),
    b.max_xwind_kts === undefined ? cur.max_xwind_kts : maxXwind(b.max_xwind_kts),
    bool(b.ifr_capable, cur.ifr_capable),
    ...PERF_FIELDS.map(([k, label, lo, hi]) => (b[k] === undefined ? cur[k] : perfInt(b[k], label, lo, hi))),
    b.sim_title === undefined ? cur.sim_title : optStr(b.sim_title),
    b.sim_livery === undefined ? cur.sim_livery : optStr(b.sim_livery),
    id,
  );
  res.json(requireAircraft(id));
}));

api.delete("/aircraft/:id", wrap((req, res) => {
  const id = idParam(req);
  requireAircraft(id);
  db.prepare(`DELETE FROM aircraft WHERE id = ?`).run(id);
  res.status(204).end();
}));

/** Upload a custom icon as a data URL: { dataUrl: "data:image/png;base64,..." } */
api.post("/aircraft/:id/icon", wrap((req, res) => {
  const id = idParam(req);
  requireAircraft(id);
  const dataUrl = String(req.body?.dataUrl ?? "");
  const m = /^data:image\/(png|jpeg|jpg|webp|gif|svg\+xml);base64,(.+)$/s.exec(dataUrl);
  if (!m) throw new HttpError(400, "dataUrl must be a base64 PNG/JPEG/WebP/GIF/SVG");
  const ext = m[1] === "jpeg" ? "jpg" : m[1] === "svg+xml" ? "svg" : m[1];
  const buf = Buffer.from(m[2], "base64");
  if (buf.length > 4 * 1024 * 1024) throw new HttpError(413, "image larger than 4 MB");
  for (const f of fs.readdirSync(IMAGES_DIR)) {
    if (f.startsWith(`aircraft-${id}.`)) fs.unlinkSync(path.join(IMAGES_DIR, f));
  }
  const file = `aircraft-${id}.${ext}`;
  fs.writeFileSync(path.join(IMAGES_DIR, file), buf);
  const icon = `/images/${file}?v=${Date.now()}`;
  db.prepare(`UPDATE aircraft SET icon = ? WHERE id = ?`).run(icon, id);
  res.json(requireAircraft(id));
}));

// ---------- hops ----------

export interface HopRow {
  id: number;
  aircraft_id: number;
  seq: number;
  origin: string;
  dest: string;
  departed_at: string | null;
  arrived_at: string | null;
  duration_min: number | null;
  notes: string;
  track: string | null;
  landings: string | null;
  stats: string | null;
  briefing_id: number | null;
  created_at: string;
}

const hopGet = db.prepare(`SELECT * FROM hops WHERE id = ?`);
const hopsForAircraft = db.prepare(`SELECT * FROM hops WHERE aircraft_id = ? ORDER BY seq, id`);
const hopsAll = db.prepare(`SELECT * FROM hops ORDER BY aircraft_id, seq, id`);
const lastHop = db.prepare(`SELECT * FROM hops WHERE aircraft_id = ? ORDER BY seq DESC, id DESC LIMIT 1`);

function requireHop(id: number): HopRow {
  const h = hopGet.get(id) as unknown as HopRow | undefined;
  if (!h) throw new HttpError(404, `hop ${id} not found`);
  return h;
}

/** Resolve a user-typed code to the canonical airport ident, or 400. */
function resolveIdent(code: unknown, label: string): string {
  const s = optStr(code);
  if (!s) throw new HttpError(400, `${label} is required`);
  const a = findAirport(s);
  if (!a) throw new HttpError(400, `${label}: unknown airport "${s}"`);
  return a.ident;
}

function parseTime(v: unknown, label: string): string | null {
  const s = optStr(v);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new HttpError(400, `${label}: invalid date/time`);
  return d.toISOString();
}

function renumber(aircraftId: number) {
  const rows = hopsForAircraft.all(aircraftId) as unknown as HopRow[];
  const upd = db.prepare(`UPDATE hops SET seq = ? WHERE id = ?`);
  rows.forEach((h, i) => {
    if (h.seq !== i + 1) upd.run(i + 1, h.id);
  });
}

api.get("/hops", wrap((req, res) => {
  const aid = req.query.aircraft_id;
  res.json(aid ? hopsForAircraft.all(Number(aid)) : hopsAll.all());
}));

api.post("/hops", wrap((req, res) => {
  const b = req.body ?? {};
  const aircraftId = Number(b.aircraft_id);
  requireAircraft(aircraftId);
  const origin = resolveIdent(b.origin, "origin");
  const dest = resolveIdent(b.dest, "destination");
  const departed = parseTime(b.departed_at, "departed_at");
  const arrived = parseTime(b.arrived_at, "arrived_at");
  const duration = optInt(b.duration_min, "duration");
  const seqRow = db.prepare(`SELECT COALESCE(MAX(seq),0)+1 AS s FROM hops WHERE aircraft_id = ?`).get(aircraftId) as { s: number };
  const r = db.prepare(`
    INSERT INTO hops (aircraft_id, seq, origin, dest, departed_at, arrived_at, duration_min, notes)
    VALUES (?,?,?,?,?,?,?,?)`).run(aircraftId, seqRow.s, origin, dest, departed, arrived, duration, optStr(b.notes) ?? "");
  res.status(201).json(requireHop(Number(r.lastInsertRowid)));
}));

api.put("/hops/:id", wrap((req, res) => {
  const id = idParam(req);
  const cur = requireHop(id);
  const b = req.body ?? {};
  const origin = b.origin === undefined ? cur.origin : resolveIdent(b.origin, "origin");
  const dest = b.dest === undefined ? cur.dest : resolveIdent(b.dest, "destination");
  const departed = b.departed_at === undefined ? cur.departed_at : parseTime(b.departed_at, "departed_at");
  const arrived = b.arrived_at === undefined ? cur.arrived_at : parseTime(b.arrived_at, "arrived_at");
  const duration = b.duration_min === undefined ? cur.duration_min : optInt(b.duration_min, "duration");
  const notes = b.notes === undefined ? cur.notes : optStr(b.notes) ?? "";
  let aircraftId = cur.aircraft_id;
  let seq = cur.seq;
  if (b.aircraft_id !== undefined && Number(b.aircraft_id) !== cur.aircraft_id) {
    aircraftId = Number(b.aircraft_id);
    requireAircraft(aircraftId);
    const seqRow = db.prepare(`SELECT COALESCE(MAX(seq),0)+1 AS s FROM hops WHERE aircraft_id = ?`).get(aircraftId) as { s: number };
    seq = seqRow.s;
  }
  db.prepare(`
    UPDATE hops SET aircraft_id=?, seq=?, origin=?, dest=?, departed_at=?, arrived_at=?, duration_min=?, notes=?
    WHERE id=?`).run(aircraftId, seq, origin, dest, departed, arrived, duration, notes, id);
  if (aircraftId !== cur.aircraft_id) renumber(cur.aircraft_id);
  res.json(requireHop(id));
}));

api.delete("/hops/:id", wrap((req, res) => {
  const id = idParam(req);
  const cur = requireHop(id);
  db.prepare(`DELETE FROM hops WHERE id = ?`).run(id);
  renumber(cur.aircraft_id);
  res.status(204).end();
}));

/** Reorder an aircraft's hops: { ids: [hopId, hopId, ...] } in the desired order. */
api.put("/aircraft/:id/hops/order", wrap((req, res) => {
  const aircraftId = idParam(req);
  requireAircraft(aircraftId);
  const ids: unknown = req.body?.ids;
  if (!Array.isArray(ids)) throw new HttpError(400, "ids must be an array");
  const existing = (hopsForAircraft.all(aircraftId) as unknown as HopRow[]).map((h) => h.id);
  const wanted = ids.map(Number);
  if (wanted.length !== existing.length || !existing.every((id) => wanted.includes(id))) {
    throw new HttpError(400, "ids must contain exactly this aircraft's hops");
  }
  const upd = db.prepare(`UPDATE hops SET seq = ? WHERE id = ?`);
  db.exec("BEGIN");
  try {
    wanted.forEach((id, i) => upd.run(i + 1, id));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  res.json(hopsForAircraft.all(aircraftId));
}));

// ---------- live tracker ----------

api.get("/tracker", wrap((_req, res) => res.json(tracker.status())));

/**
 * Server-sent events: `status` about once a second, `track` (the live leg's full point list),
 * `point` (one new point), `hop` when a leg was logged, `pending` when one needs details.
 */
api.get("/tracker/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send("status", tracker.status());
  send("track", tracker.track());
  const handlers = ["status", "track", "point", "hop", "pending"].map((ev) => [ev, (d: unknown) => send(ev, d)] as const);
  for (const [ev, fn] of handlers) tracker.on(ev, fn);
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  req.on("close", () => {
    clearInterval(ping);
    for (const [ev, fn] of handlers) tracker.off(ev, fn);
  });
});

/** Bind the sim aircraft being flown to a fleet row: { aircraft_id }. Remembered on the aircraft. */
api.post("/tracker/bind", wrap((req, res) => {
  const id = Number(req.body?.aircraft_id);
  requireAircraft(id);
  try {
    tracker.bind(id);
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : String(e));
  }
  res.json(tracker.status());
}));

/** Log the pending leg, optionally supplying { aircraft_id, origin, dest } the tracker lacked. */
api.post("/tracker/pending", wrap((req, res) => {
  const b = req.body ?? {};
  const o = {
    aircraft_id: b.aircraft_id === undefined || b.aircraft_id === null ? undefined : Number(b.aircraft_id),
    origin: b.origin === undefined || b.origin === null || b.origin === "" ? undefined : resolveIdent(b.origin, "origin"),
    dest: b.dest === undefined || b.dest === null || b.dest === "" ? undefined : resolveIdent(b.dest, "destination"),
  };
  if (o.aircraft_id !== undefined) requireAircraft(o.aircraft_id);
  try {
    res.status(201).json(tracker.savePending(o));
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : String(e));
  }
}));

api.delete("/tracker/pending", wrap((_req, res) => {
  tracker.discardPending();
  res.json(tracker.status());
}));

api.delete("/tracker/leg", wrap((_req, res) => {
  tracker.discardLeg("discarded from the app");
  res.json(tracker.status());
}));

/** Test feed, only with TRACKER_FAKE=1: one SimSample per call (see scripts/sim-fake.ts). */
api.post("/tracker/sample", wrap((req, res) => {
  if (process.env.TRACKER_FAKE !== "1") throw new HttpError(403, "start the server with TRACKER_FAKE=1 to accept synthetic samples");
  const b = req.body ?? {};
  const num = (k: string) => {
    const n = Number(b[k]);
    if (!Number.isFinite(n)) throw new HttpError(400, `${k} must be a number`);
    return n;
  };
  const numOr = (k: string, d: number) => (b[k] === undefined || b[k] === null ? d : num(k));
  if (!tracker.connected) tracker.setConnected(true, "fake feed");
  const td = b.touchdown && typeof b.touchdown === "object" ? b.touchdown : null;
  tracker.feed({
    t: num("t"),
    lat: num("lat"),
    lon: num("lon"),
    alt_ft: num("alt_ft"),
    on_ground: !!b.on_ground,
    gs_kts: num("gs_kts"),
    hdg_deg: num("hdg_deg"),
    vs_fpm: numOr("vs_fpm", 0),
    ias_kts: numOr("ias_kts", numOr("gs_kts", 0)),
    g: numOr("g", 1),
    fuel_lb: numOr("fuel_lb", 0),
    weight_lb: numOr("weight_lb", 0),
    title: String(b.title ?? ""),
    livery: String(b.livery ?? ""),
    atc_id: String(b.atc_id ?? ""),
    touchdown: td
      ? {
          t: Number(td.t ?? b.t),
          fpm: Number(td.fpm ?? 0),
          g: Number(td.g ?? 1),
          ias_kts: Number(td.ias_kts ?? 0),
          sim_fpm: td.sim_fpm == null ? null : Number(td.sim_fpm),
          pitch_deg: td.pitch_deg == null ? null : Number(td.pitch_deg),
          bank_deg: td.bank_deg == null ? null : Number(td.bank_deg),
        }
      : undefined,
  });
  res.json(tracker.status());
}));

// ---------- settings ----------

const settingGet = db.prepare(`SELECT value FROM settings WHERE key = ?`);
const settingSet = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
const settingDel = db.prepare(`DELETE FROM settings WHERE key = ?`);
const SETTING_KEYS = ["simbrief_username"] as const;

function readSettings(): Record<(typeof SETTING_KEYS)[number], string | null> {
  const out = {} as Record<(typeof SETTING_KEYS)[number], string | null>;
  for (const k of SETTING_KEYS) out[k] = (settingGet.get(k) as { value: string } | undefined)?.value ?? null;
  return out;
}

api.get("/settings", wrap((_req, res) => res.json(readSettings())));

api.put("/settings", wrap((req, res) => {
  const b = req.body ?? {};
  for (const k of SETTING_KEYS) {
    if (b[k] === undefined) continue;
    const v = optStr(b[k]);
    if (v) settingSet.run(k, v);
    else settingDel.run(k);
  }
  res.json(readSettings());
}));

// ---------- SimBrief briefings ----------

const briefingInsert = db.prepare(
  `INSERT INTO briefings (hop_id, aircraft_id, ofp_id, generated_at, origin, dest, summary, plan_html, ofp, fetched_at)
   VALUES (?,?,?,?,?,?,?,?,?,?)`,
);
const briefingGet = db.prepare(`SELECT id, hop_id, aircraft_id, summary, plan_html, fetched_at FROM briefings WHERE id = ?`);
const briefingByHop = db.prepare(`SELECT id, hop_id, aircraft_id, summary, plan_html, fetched_at FROM briefings WHERE hop_id = ? ORDER BY id DESC LIMIT 1`);
const briefingDelete = db.prepare(`DELETE FROM briefings WHERE id = ?`);
const hopSetBriefing = db.prepare(`UPDATE hops SET briefing_id = ? WHERE id = ?`);

interface BriefingRow {
  id: number;
  hop_id: number | null;
  aircraft_id: number | null;
  summary: string;
  plan_html: string | null;
  fetched_at: string;
}

function briefingOut(r: BriefingRow) {
  return { ...(JSON.parse(r.summary) as Omit<BriefingSummary, "id">), id: r.id, hop_id: r.hop_id, aircraft_id: r.aircraft_id, plan_html: r.plan_html, fetched_at: r.fetched_at };
}

/** Pull the latest OFP for the configured pilot (or an explicit one) or fail with SimBrief's message. */
async function latestOfp(explicit?: unknown): Promise<FetchedOfp> {
  const user = optStr(explicit) ?? readSettings().simbrief_username;
  if (!user) throw new HttpError(400, "set your SimBrief alias or pilot ID first");
  try {
    return await fetchLatestOfp(user);
  } catch (e) {
    throw new HttpError(502, `SimBrief: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function storeBriefing(ofp: FetchedOfp, hopId: number | null, aircraftId: number | null): BriefingSummary {
  const s = ofp.summary;
  const r = briefingInsert.run(
    hopId,
    aircraftId,
    s.ofp_id,
    s.generated_at,
    s.origin.icao,
    s.dest.icao,
    JSON.stringify(s),
    ofp.plan_html,
    JSON.stringify(ofp.raw),
    new Date().toISOString(),
  );
  return { ...s, id: Number(r.lastInsertRowid) };
}

/** Preview the pilot's latest OFP without storing it (for the "is this the right plan?" step). */
api.get("/simbrief/latest", wrap(async (req, res) => {
  const ofp = await latestOfp(req.query.username);
  res.json({ ...ofp.summary, id: null, has_plan_html: !!ofp.plan_html });
}));

/** Import the latest OFP for the flight being flown (or the next one). */
api.post("/tracker/briefing", wrap(async (_req, res) => {
  const ofp = await latestOfp();
  const st = tracker.status();
  const summary = storeBriefing(ofp, null, st.aircraft_id);
  tracker.setBriefing(summary);
  res.status(201).json(tracker.status());
}));

api.delete("/tracker/briefing", wrap((_req, res) => {
  tracker.setBriefing(null);
  res.json(tracker.status());
}));

api.get("/briefings/:id", wrap((req, res) => {
  const r = briefingGet.get(idParam(req)) as unknown as BriefingRow | undefined;
  if (!r) throw new HttpError(404, "briefing not found");
  res.json(briefingOut(r));
}));

api.get("/hops/:id/briefing", wrap((req, res) => {
  const hop = requireHop(idParam(req));
  const r = (hop.briefing_id != null ? briefingGet.get(hop.briefing_id) : briefingByHop.get(hop.id)) as unknown as BriefingRow | undefined;
  if (!r) throw new HttpError(404, "this hop has no briefing");
  res.json(briefingOut(r));
}));

/** Attach the pilot's latest OFP to an already-logged hop. */
api.post("/hops/:id/briefing", wrap(async (req, res) => {
  const hop = requireHop(idParam(req));
  const ofp = await latestOfp();
  const summary = storeBriefing(ofp, hop.id, hop.aircraft_id);
  hopSetBriefing.run(summary.id, hop.id);
  res.status(201).json(briefingOut(briefingGet.get(summary.id) as unknown as BriefingRow));
}));

api.delete("/hops/:id/briefing", wrap((req, res) => {
  const hop = requireHop(idParam(req));
  if (hop.briefing_id != null) briefingDelete.run(hop.briefing_id);
  hopSetBriefing.run(null, hop.id);
  res.status(204).end();
}));

// ---------- SimBrief ----------

/** SimBrief's aircraft type list (ICAO designator + name), cached daily. */
api.get("/simbrief/aircraft", wrap(async (_req, res) => res.json(await simbriefAircraftTypes())));

// ---------- planner ----------

/**
 * Airports reachable from where an aircraft is parked.
 *   GET /api/plan?aircraft_id=1&max_minutes=120[&types=small_airport,medium_airport][&paved=1]
 *                [&min_runway_ft=2500][&from=KBOS][&limit=1500]
 */
api.get("/plan", wrap((req, res) => {
  const aircraft = requireAircraft(Number(req.query.aircraft_id));
  if (!aircraft.cruise_kts) throw new HttpError(400, "set a cruise speed on this aircraft to use the planner");
  const maxMinutes = Number(req.query.max_minutes);
  if (!Number.isFinite(maxMinutes) || maxMinutes <= 0 || maxMinutes > 24 * 60) {
    throw new HttpError(400, "max_minutes must be between 1 and 1440");
  }

  let originIdent = optStr(req.query.from);
  if (!originIdent) {
    const last = lastHop.get(aircraft.id) as unknown as HopRow | undefined;
    if (!last) throw new HttpError(400, "this aircraft has no hops yet; pass ?from=ICAO to plan from a starting airport");
    originIdent = last.dest;
  }
  const origin = findAirport(originIdent);
  if (!origin) throw new HttpError(400, `unknown airport "${originIdent}"`);

  const typesParam = optStr(req.query.types);
  const types = typesParam ? typesParam.split(",").map((t) => t.trim()) : ["large_airport", "medium_airport", "small_airport"];
  const bad = types.filter((t) => !(AIRPORT_TYPES as readonly string[]).includes(t));
  if (bad.length) throw new HttpError(400, `unknown airport type(s): ${bad.join(", ")}`);

  const minRunway = req.query.min_runway_ft === undefined ? aircraft.min_runway_ft : minRunwayFt(req.query.min_runway_ft);
  const cruiseAlt = perfInt(req.query.cruise_alt_ft, "cruise altitude", 500, 60000);
  const profile = profileFor({ ...aircraft, cruise_kts: aircraft.cruise_kts }, cruiseAlt);
  const originElev = origin.elevation_ft ?? 0;
  // Ring radius for a destination at the origin's elevation; each candidate is then timed with its own.
  const rangeNm = maxRangeNm(profile, maxMinutes, originElev);
  const limit = Math.min(20000, Math.max(1, Number(req.query.limit ?? 5000) || 5000));
  const elevation = maxFieldElevation(aircraft);

  // Search slightly beyond the ring: a high destination needs less descent and can sit a bit outside it.
  const { candidates: found, total: _unused } = planCandidates(origin, {
    rangeNm: rangeNm * 1.1,
    types,
    pavedOnly: req.query.paved === "1",
    minRunwayFt: minRunway,
    maxElevationFt: elevation.max_elevation_ft,
    limit: limit * 2,
  });
  void _unused;
  const timed = found
    .map((c) => ({ ...c, est_minutes: Math.round(blockMinutes(profile, c.distance_nm, originElev, c.elevation_ft ?? 0)) }))
    .filter((c) => c.est_minutes <= maxMinutes);
  const total = timed.length;
  const candidates = timed.slice(0, limit);

  res.json({
    aircraft_id: aircraft.id,
    cruise_kts: aircraft.cruise_kts,
    max_minutes: maxMinutes,
    range_nm: rangeNm,
    naive_range_nm: (aircraft.cruise_kts * maxMinutes) / 60,
    profile,
    min_runway_ft: minRunway,
    paved_only: req.query.paved === "1",
    types,
    ...elevation,
    origin: attachRunways([origin])[0],
    total,
    truncated: total > candidates.length,
    /** When truncated: how far out the returned (nearest-first) set actually reaches. */
    shown_nm: candidates.length ? candidates[candidates.length - 1].distance_nm : 0,
    candidates,
  });
}));

// ---------- weather hazards & terrain ----------

/** Current G-AIRMET / SIGMET hazard areas (icing, turbulence, IFR, convective...), cached 10 min. */
api.get("/hazards", wrap(async (_req, res) => res.json(await currentHazards())));

/**
 * Terrain along a leg: GET /api/terrain?from=lat,lon&to=lat,lon[&n=24]
 * Returns samples, the highest point, and a suggested minimum en-route altitude.
 */
api.get("/terrain", wrap(async (req, res) => {
  const parse = (v: unknown, label: string): [number, number] => {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(String(v ?? ""));
    if (!m) throw new HttpError(400, `${label} must be lat,lon`);
    const lat = Number(m[1]), lon = Number(m[2]);
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new HttpError(400, `${label} out of range`);
    return [lat, lon];
  };
  const from = parse(req.query.from, "from");
  const to = parse(req.query.to, "to");
  const n = Math.min(99, Math.max(4, Number(req.query.n ?? 24) || 24));
  const profile = await terrainAlong(from, to, n);
  // 1,000 ft clearance over flat country, 2,000 ft where the terrain is high (FAR 91.177 style).
  const clearance = profile.max_ft > 5000 ? 2000 : 1000;
  const minAlt = Math.ceil((profile.max_ft + clearance) / 500) * 500;
  res.json({ ...profile, clearance_ft: clearance, min_altitude_ft: minAlt, oxygen_altitude_ft: OXYGEN_ALTITUDE_FT });
}));

// ---------- whole-map state ----------

/** Everything the map needs in one call: aircraft, hops, and every referenced airport (with runways). */
api.get("/state", wrap((_req, res) => {
  const aircraft = aircraftList.all() as unknown as AircraftRow[];
  const hops = hopsAll.all() as unknown as HopRow[];
  const airports: Record<string, AirportFull> = {};
  for (const h of hops) {
    for (const code of [h.origin, h.dest]) {
      if (!airports[code]) {
        const a = findAirport(code);
        if (a) airports[code] = attachRunways([a])[0];
      }
    }
  }
  res.json({ aircraft, hops, airports, airportCount: airportCount(), runwayCount: runwayCount() });
}));

api.get("/status", wrap((_req, res) => {
  res.json({ ok: true, airports: airportCount(), runways: runwayCount(), version: "0.8.0" });
}));

// ---------- errors ----------

api.use((_req, res) => res.status(404).json({ error: "not found" }));

api.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
  } else {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "internal error" });
  }
});
