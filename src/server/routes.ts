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
  planCandidates,
  searchAirports,
  wikiSummary,
  type AirportFull,
} from "./airports.ts";

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
  created_at: string;
}

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

api.get("/aircraft", wrap((_req, res) => res.json(aircraftList.all())));

api.post("/aircraft", wrap((req, res) => {
  const b = req.body ?? {};
  const name = optStr(b.name);
  if (!name) throw new HttpError(400, "name is required");
  const color = optStr(b.color) ?? "#ff6b35";
  if (!COLOR_RE.test(color)) throw new HttpError(400, "color must be #rrggbb");
  const r = db
    .prepare(`INSERT INTO aircraft (name, livery, color, icon, notes, cruise_kts, min_runway_ft) VALUES (?,?,?,?,?,?,?)`)
    .run(
      name, optStr(b.livery) ?? "", color, optStr(b.icon) ?? "builtin:twin-piston", optStr(b.notes) ?? "",
      cruiseKts(b.cruise_kts), minRunwayFt(b.min_runway_ft),
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
  db.prepare(`UPDATE aircraft SET name=?, livery=?, color=?, icon=?, notes=?, visible=?, cruise_kts=?, min_runway_ft=? WHERE id=?`).run(
    name,
    b.livery === undefined ? cur.livery : optStr(b.livery) ?? "",
    color,
    b.icon === undefined ? cur.icon : optStr(b.icon) ?? "builtin:twin-piston",
    b.notes === undefined ? cur.notes : optStr(b.notes) ?? "",
    b.visible === undefined ? cur.visible : b.visible ? 1 : 0,
    b.cruise_kts === undefined ? cur.cruise_kts : cruiseKts(b.cruise_kts),
    b.min_runway_ft === undefined ? cur.min_runway_ft : minRunwayFt(b.min_runway_ft),
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
  const rangeNm = (aircraft.cruise_kts * maxMinutes) / 60;
  const limit = Math.min(20000, Math.max(1, Number(req.query.limit ?? 5000) || 5000));

  const { candidates, total } = planCandidates(origin, {
    rangeNm,
    types,
    pavedOnly: req.query.paved === "1",
    minRunwayFt: minRunway,
    limit,
  });

  res.json({
    aircraft_id: aircraft.id,
    cruise_kts: aircraft.cruise_kts,
    max_minutes: maxMinutes,
    range_nm: rangeNm,
    min_runway_ft: minRunway,
    paved_only: req.query.paved === "1",
    types,
    origin: attachRunways([origin])[0],
    total,
    truncated: total > candidates.length,
    /** When truncated: how far out the returned (nearest-first) set actually reaches. */
    shown_nm: candidates.length ? candidates[candidates.length - 1].distance_nm : 0,
    candidates: candidates.map((c) => ({ ...c, est_minutes: Math.round((c.distance_nm / aircraft.cruise_kts!) * 60) })),
  });
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
  res.json({ ok: true, airports: airportCount(), runways: runwayCount(), version: "0.6.0" });
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
