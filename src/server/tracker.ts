import { EventEmitter } from "node:events";
import { db } from "./db.ts";
import { distanceNm, nearestAirport } from "./airports.ts";
import type { SimAircraft, SimSample, Touchdown } from "./simconnect.ts";
import type { BriefingSummary } from "./ofp.ts";

/**
 * Turns a stream of position samples from the sim into logged hops.
 *
 * Phases: idle → ground → airborne → landed → (hop logged) → ground. A takeoff is the on-ground
 * flag staying false for TAKEOFF_CONFIRM_MS; a landing is the flag coming back on, and the hop
 * closes once the aircraft has sat below STOP_KTS for STOP_MS (so a touch-and-go stays inside
 * one hop). Origin and destination are the nearest airports to where the wheels left and where
 * the aircraft stopped. The in-progress leg is checkpointed to `tracker_state` so a server
 * restart mid-flight loses nothing.
 *
 * Each touchdown is rated from its descent rate and peak G (see rateLanding). The frame-rate
 * watcher in simconnect.ts supplies accurate numbers a moment after the wheels touch; until then
 * (and always with the fake feed) a provisional landing is derived from the 1 Hz samples.
 *
 * A finished leg is logged straight into `hops` (with track, landings, stats and any SimBrief
 * briefing imported for it) when the sim aircraft is bound to a fleet row and both airports are
 * known; otherwise it is parked as `pending` for the user to complete from the UI.
 */

/** `[lat, lon, alt_ft, unix_seconds, gs_kts, vs_fpm, ias_kts, fuel_lb]`; old rows have the first four only. */
export type TrackPoint = number[];
export type Phase = "idle" | "ground" | "airborne" | "landed";

/** Airborne this long before a takeoff counts (filters runway bounces). */
const TAKEOFF_CONFIRM_MS = 5000;
/** Stopped (below STOP_KTS) this long after landing before the hop is logged. */
const STOP_MS = 30000;
const STOP_KTS = 5;
/** Spacing of recorded track points. */
const SAMPLE_MS = 5000;
/** How far from an airport's reference point a takeoff or stop still counts as that airport. */
export const NEAR_NM = 5;
/** A jump beyond this (plus what 700 kt could cover in the gap) means slew, teleport or a new flight. */
const TELEPORT_NM = 50;
/** Legs shorter than this are bounces, not flights. */
const MIN_LEG_MIN = 1;
/** Checkpoint the in-progress leg to the database at most this often outside phase changes. */
const SAVE_MS = 5000;
/** A frame-accurate touchdown within this of a provisional one replaces it. */
const TOUCHDOWN_MATCH_MS = 6000;

// ------------------------------------------------------------------ landings

export type LandingRating = "butter" | "solid" | "hard" | "hospital" | "graveyard";
const RATINGS: LandingRating[] = ["butter", "solid", "hard", "hospital", "graveyard"];
/** Upper bound of descent rate (fpm) for each rating; the last is open-ended. */
const FPM_LIMITS = [100, 250, 500, 800];
/** Upper bound of peak G for each rating. A hard G floor bumps a gentle-looking fpm up a class. */
const G_LIMITS = [1.6, 2.0, 2.6, 3.5];

export function rateLanding(fpm: number, g: number | null): LandingRating {
  let r = FPM_LIMITS.findIndex((lim) => fpm <= lim);
  if (r < 0) r = 4;
  if (g != null && Number.isFinite(g)) {
    let byG = G_LIMITS.findIndex((lim) => g < lim);
    if (byG < 0) byG = 4;
    r = Math.max(r, byG);
  }
  return RATINGS[r];
}

export interface Landing {
  t: string;
  /** Descent rate at touchdown, fpm, positive down. */
  fpm: number;
  /** Peak load factor just after touchdown (null when only 1 Hz samples were available). */
  g: number | null;
  ias_kts: number | null;
  /** The sim's own touchdown normal velocity as fpm, for comparison with third-party monitors. */
  sim_fpm: number | null;
  pitch_deg: number | null;
  bank_deg: number | null;
  lat: number;
  lon: number;
  rating: LandingRating;
  /** "frames" from the per-frame watcher, "samples" derived from 1 Hz data. */
  source: "frames" | "samples";
}

export interface HopStats {
  fuel_start_lb: number | null;
  fuel_end_lb: number | null;
  fuel_used_lb: number | null;
  weight_start_lb: number | null;
  weight_end_lb: number | null;
  max_alt_ft: number | null;
  max_gs_kts: number | null;
  flown_nm: number | null;
}

// ------------------------------------------------------------------ state

interface Leg {
  origin: string | null;
  /** Takeoff, epoch ms. */
  departed_at: number;
  /** Most recent touchdown, epoch ms; cleared again by a touch-and-go. */
  touchdown_at: number | null;
  track: TrackPoint[];
  landings: Landing[];
  fuel_start_lb: number | null;
  weight_start_lb: number | null;
  max_alt_ft: number;
  max_gs_kts: number;
}

export interface PendingLeg {
  sim: SimAircraft;
  aircraft_id: number | null;
  origin: string | null;
  dest: string | null;
  departed_at: string;
  arrived_at: string;
  duration_min: number;
  track: TrackPoint[];
  landings: Landing[];
  stats: HopStats;
  briefing_id: number | null;
  /** Why it was not logged automatically. */
  reason: string;
}

interface Persisted {
  phase: Phase;
  sim: SimAircraft | null;
  aircraft_id: number | null;
  leg: Leg | null;
  pending: PendingLeg | null;
  /** SimBrief plan imported for the flight being flown (or about to be); consumed by the next hop. */
  briefing: BriefingSummary | null;
  last: SimSample | null;
  lastGround: SimSample | null;
  lastAirborne: SimSample | null;
  airborneSince: number | null;
  stopSince: number | null;
  message: string | null;
  message_at: string | null;
}

export interface TrackerStatus {
  connected: boolean;
  sim_name: string | null;
  sim_running: boolean;
  paused: boolean;
  livery_supported: boolean;
  sim: SimAircraft | null;
  aircraft_id: number | null;
  phase: Phase;
  position: {
    lat: number;
    lon: number;
    alt_ft: number;
    gs_kts: number;
    hdg_deg: number;
    vs_fpm: number;
    ias_kts: number;
    fuel_lb: number;
    on_ground: boolean;
    t: string;
  } | null;
  leg: {
    origin: string | null;
    departed_at: string;
    touchdown_at: string | null;
    points: number;
    landings: Landing[];
    max_alt_ft: number;
    fuel_used_lb: number | null;
  } | null;
  pending: (Omit<PendingLeg, "track"> & { points: number }) | null;
  briefing: BriefingSummary | null;
  message: string | null;
  message_at: string | null;
}

export interface LoggedHop {
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

const EMPTY: Persisted = {
  phase: "idle",
  sim: null,
  aircraft_id: null,
  leg: null,
  pending: null,
  briefing: null,
  last: null,
  lastGround: null,
  lastAirborne: null,
  airborneSince: null,
  stopSince: null,
  message: null,
  message_at: null,
};

const loadStmt = db.prepare(`SELECT json FROM tracker_state WHERE id = 1`);
const saveStmt = db.prepare(
  `INSERT INTO tracker_state (id, json, updated_at) VALUES (1, ?, ?)
   ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
);
const bindLookup = db.prepare(
  `SELECT id FROM aircraft WHERE sim_title = ? AND (sim_livery = ? OR sim_livery IS NULL OR sim_livery = '')
   ORDER BY (sim_livery = ?) DESC, id LIMIT 1`,
);
const bindSet = db.prepare(`UPDATE aircraft SET sim_title = ?, sim_livery = ? WHERE id = ?`);
const aircraftExists = db.prepare(`SELECT id FROM aircraft WHERE id = ?`);
const nextSeq = db.prepare(`SELECT COALESCE(MAX(seq),0)+1 AS s FROM hops WHERE aircraft_id = ?`);
const insertHopStmt = db.prepare(
  `INSERT INTO hops (aircraft_id, seq, origin, dest, departed_at, arrived_at, duration_min, notes, track, landings, stats, briefing_id)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
);
const hopGet = db.prepare(`SELECT * FROM hops WHERE id = ?`);
const briefingAttach = db.prepare(`UPDATE briefings SET hop_id = ?, aircraft_id = ? WHERE id = ?`);
const briefingDropUnused = db.prepare(`DELETE FROM briefings WHERE id = ? AND hop_id IS NULL`);

function load(): Persisted {
  const row = loadStmt.get() as { json: string } | undefined;
  if (!row) return { ...EMPTY };
  try {
    const p = { ...EMPTY, ...(JSON.parse(row.json) as Partial<Persisted>) };
    // A leg checkpointed by an older version lacks the landing/stat fields.
    if (p.leg) {
      const defaults: Partial<Leg> = { landings: [], fuel_start_lb: null, weight_start_lb: null, max_alt_ft: 0, max_gs_kts: 0 };
      p.leg = { ...defaults, ...(p.leg as Partial<Leg>) } as Leg;
      // A leg that began at the main menu's null-island position is not a flight.
      const first = p.leg.track[0];
      if (first && !isRealPosition({ lat: first[0], lon: first[1], alt_ft: first[2] })) {
        console.log("[tracker] dropped a checkpointed leg that started at the sim's menu position");
        p.leg = null;
        p.phase = "idle";
      }
    }
    return p;
  } catch {
    return { ...EMPTY };
  }
}

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * In the main menu (and while a flight loads) the sim reports the user aircraft parked at
 * latitude 0, longitude 0, tens of thousands of feet up and "airborne". Nothing real happens
 * within a few miles of that spot, so such samples are ignored rather than becoming a leg.
 */
export function isRealPosition(s: { lat: number; lon: number; alt_ft: number }): boolean {
  if (!Number.isFinite(s.lat) || !Number.isFinite(s.lon) || !Number.isFinite(s.alt_ft)) return false;
  return Math.abs(s.lat) > 0.05 || Math.abs(s.lon) > 0.05;
}
const round = (v: number, places: number) => Number(v.toFixed(places));
const fin = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const point = (s: SimSample): TrackPoint => [
  round(s.lat, 5),
  round(s.lon, 5),
  Math.round(s.alt_ft),
  Math.round(s.t / 1000),
  Math.round(fin(s.gs_kts)),
  Math.round(fin(s.vs_fpm)),
  Math.round(fin(s.ias_kts)),
  Math.round(fin(s.fuel_lb)),
];

function fmtMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} h ${m.toString().padStart(2, "0")} min` : `${m} min`;
}

function trackNm(track: TrackPoint[]): number {
  let nm = 0;
  for (let i = 1; i < track.length; i++) nm += distanceNm(track[i - 1][0], track[i - 1][1], track[i][0], track[i][1]);
  return round(nm, 1);
}

interface HopDraft {
  origin: string;
  dest: string;
  departed_at: string;
  arrived_at: string;
  duration_min: number;
  track: TrackPoint[];
  landings: Landing[];
  stats: HopStats;
  briefing_id: number | null;
}

function insertHop(aircraftId: number, h: HopDraft): LoggedHop {
  const seq = (nextSeq.get(aircraftId) as { s: number }).s;
  const r = insertHopStmt.run(
    aircraftId,
    seq,
    h.origin,
    h.dest,
    h.departed_at,
    h.arrived_at,
    h.duration_min,
    "",
    JSON.stringify(h.track),
    JSON.stringify(h.landings),
    JSON.stringify(h.stats),
    h.briefing_id,
  );
  const id = Number(r.lastInsertRowid);
  if (h.briefing_id != null) briefingAttach.run(id, aircraftId, h.briefing_id);
  return hopGet.get(id) as unknown as LoggedHop;
}

export class Tracker extends EventEmitter {
  private s: Persisted;
  private lastSave = 0;
  connected = false;
  simName: string | null = null;
  simRunning = true;
  paused = false;
  liverySupported = true;

  constructor() {
    super();
    this.s = load();
  }

  // ------------------------------------------------------------------ status

  status(): TrackerStatus {
    const st = this.s;
    const l = st.last;
    const leg = st.leg;
    const { track: pendingTrack, ...pendingRest } = st.pending ?? { track: [] as TrackPoint[] };
    return {
      connected: this.connected,
      sim_name: this.simName,
      sim_running: this.simRunning,
      paused: this.paused,
      livery_supported: this.liverySupported,
      sim: st.sim,
      aircraft_id: st.aircraft_id,
      phase: st.phase,
      position: l
        ? {
            lat: l.lat,
            lon: l.lon,
            alt_ft: Math.round(fin(l.alt_ft)),
            gs_kts: Math.round(fin(l.gs_kts)),
            hdg_deg: Math.round(fin(l.hdg_deg)),
            vs_fpm: Math.round(fin(l.vs_fpm)),
            ias_kts: Math.round(fin(l.ias_kts)),
            fuel_lb: Math.round(fin(l.fuel_lb)),
            on_ground: l.on_ground,
            t: iso(l.t),
          }
        : null,
      leg: leg
        ? {
            origin: leg.origin,
            departed_at: iso(leg.departed_at),
            touchdown_at: leg.touchdown_at ? iso(leg.touchdown_at) : null,
            points: leg.track.length,
            landings: leg.landings,
            max_alt_ft: leg.max_alt_ft,
            fuel_used_lb: leg.fuel_start_lb != null && l ? Math.round(leg.fuel_start_lb - fin(l.fuel_lb)) : null,
          }
        : null,
      pending: st.pending ? { ...(pendingRest as Omit<PendingLeg, "track">), points: pendingTrack.length } : null,
      briefing: st.briefing,
      message: st.message,
      message_at: st.message_at,
    };
  }

  /** The in-progress leg's recorded points (empty when nothing is being flown). */
  track(): TrackPoint[] {
    return this.s.leg?.track ?? [];
  }

  // ------------------------------------------------------------------ link events

  setConnected(v: boolean, name: string | null = null) {
    this.connected = v;
    this.simName = v ? name : null;
    if (!v) {
      this.simRunning = true;
      this.paused = false;
      if (this.s.leg) {
        if (this.s.phase === "landed" && this.s.last) this.complete(this.s.last);
        else this.discardLeg("the sim disconnected mid-flight");
      }
    }
    this.emitStatus();
  }

  setPaused(v: boolean) {
    this.paused = v;
    this.emitStatus();
  }

  setSimRunning(v: boolean) {
    this.simRunning = v;
    this.emitStatus();
  }

  setLiverySupported(v: boolean) {
    this.liverySupported = v;
    this.emitStatus();
  }

  flightLoaded(_file: string) {
    if (this.s.leg && this.s.phase === "airborne") this.discardLeg("a new flight was loaded");
  }

  // ------------------------------------------------------------------ user actions

  /** Bind the sim aircraft currently being flown to a fleet row (and remember the pairing). */
  bind(aircraftId: number): void {
    const st = this.s;
    if (!st.sim) throw new Error("no sim aircraft to bind yet");
    if (!aircraftExists.get(aircraftId)) throw new Error(`aircraft ${aircraftId} not found`);
    bindSet.run(st.sim.title, st.sim.livery, aircraftId);
    st.aircraft_id = aircraftId;
    if (st.pending) st.pending.aircraft_id = aircraftId;
    this.note(`Bound ${st.sim.title}${st.sim.livery ? ` (${st.sim.livery})` : ""} to fleet aircraft #${aircraftId}`);
    this.save(true);
    this.emitStatus();
  }

  /** Attach (or clear) the SimBrief plan for the flight being flown or about to be flown. */
  setBriefing(b: BriefingSummary | null): void {
    const prev = this.s.briefing;
    this.s.briefing = b;
    if (prev && (!b || b.id !== prev.id)) briefingDropUnused.run(prev.id);
    this.note(b ? `SimBrief plan ${b.origin.icao ?? "?"} → ${b.dest.icao ?? "?"} attached to this flight` : "SimBrief plan removed");
    this.save(true);
    this.emitStatus();
  }

  discardLeg(reason: string): void {
    const st = this.s;
    if (!st.leg) return;
    st.leg = null;
    st.phase = st.last?.on_ground ? "ground" : "idle";
    st.lastGround = st.last?.on_ground ? st.last : null;
    st.airborneSince = null;
    st.stopSince = null;
    this.note(`Discarded the current leg: ${reason}`);
    this.emit("track", []);
    this.save(true);
    this.emitStatus();
  }

  /**
   * Close the landed leg now instead of waiting for the stop timer: for when the sim freezes or
   * is quit after touchdown. Only a leg whose wheels are down can be logged this way.
   */
  completeNow(): void {
    const st = this.s;
    if (!st.leg) throw new Error("no leg is being flown");
    if (st.phase !== "landed" || !st.last) throw new Error("the aircraft has not landed yet");
    this.complete(st.last);
  }

  /** Log the pending leg as a hop, filling in whatever the tracker could not work out. */
  savePending(o: { aircraft_id?: number | null; origin?: string | null; dest?: string | null }): LoggedHop {
    const p = this.s.pending;
    if (!p) throw new Error("there is no leg waiting to be logged");
    const aircraftId = o.aircraft_id ?? p.aircraft_id;
    const origin = o.origin ?? p.origin;
    const dest = o.dest ?? p.dest;
    if (!aircraftId || !aircraftExists.get(aircraftId)) throw new Error("choose a fleet aircraft for this leg");
    if (!origin) throw new Error("the departure airport is required");
    if (!dest) throw new Error("the arrival airport is required");
    const hop = insertHop(aircraftId, {
      origin,
      dest,
      departed_at: p.departed_at,
      arrived_at: p.arrived_at,
      duration_min: p.duration_min,
      track: p.track,
      landings: p.landings ?? [],
      stats: p.stats,
      briefing_id: p.briefing_id ?? null,
    });
    this.s.pending = null;
    this.note(`Logged ${origin} → ${dest}, ${fmtMin(p.duration_min)}`);
    this.emit("hop", hop);
    this.save(true);
    this.emitStatus();
    return hop;
  }

  discardPending(): void {
    const p = this.s.pending;
    if (!p) return;
    if (p.briefing_id != null) briefingDropUnused.run(p.briefing_id);
    this.s.pending = null;
    this.note("Discarded the unlogged leg");
    this.save(true);
    this.emitStatus();
  }

  // ------------------------------------------------------------------ samples

  feed(s: SimSample): void {
    const st = this.s;
    if (!this.simRunning || this.paused || !isRealPosition(s)) {
      this.emitStatus();
      return;
    }

    // Which aircraft is being flown? A change mid-leg means the user loaded a different plane.
    if (!st.sim || st.sim.title !== s.title || st.sim.livery !== s.livery) {
      if (st.sim && st.leg) {
        if (st.phase === "landed") this.complete(st.last ?? s);
        else this.discardLeg(`the aircraft changed to ${s.title}`);
      }
      st.sim = { title: s.title, livery: s.livery, atc_id: s.atc_id };
      st.aircraft_id = this.lookupBinding(s.title, s.livery);
      this.note(
        st.aircraft_id
          ? `Flying ${s.title}${s.livery ? ` (${s.livery})` : ""}`
          : `${s.title}${s.livery ? ` (${s.livery})` : ""} is not bound to a fleet aircraft`,
      );
    } else if (st.sim.atc_id !== s.atc_id) {
      st.sim.atc_id = s.atc_id;
    }

    // Slew, teleport, or a new flight loaded somewhere else.
    if (st.last) {
      const gapHours = Math.max(0, s.t - st.last.t) / 3600000;
      const d = distanceNm(st.last.lat, st.last.lon, s.lat, s.lon);
      if (d > TELEPORT_NM + gapHours * 700) {
        if (st.leg) this.discardLeg(`the position jumped ${Math.round(d)} nm`);
        st.phase = "idle";
        st.lastGround = null;
        st.lastAirborne = null;
        st.airborneSince = null;
        st.stopSince = null;
      }
    }

    if (s.touchdown && st.leg) this.applyTouchdown(st.leg, s.touchdown, s);

    switch (st.phase) {
      case "idle":
        if (s.on_ground) {
          st.phase = "ground";
          st.lastGround = s;
        } else {
          st.phase = "airborne";
          st.leg = this.newLeg(null, s.t, s, [point(s)]);
          this.note("Tracking started in the air: the departure airport is unknown");
          this.emit("track", st.leg.track);
        }
        break;

      case "ground":
        if (s.on_ground) {
          st.lastGround = s;
          st.airborneSince = null;
        } else {
          st.airborneSince ??= s.t;
          if (s.t - st.airborneSince >= TAKEOFF_CONFIRM_MS) {
            const g = st.lastGround ?? s;
            const ap = nearestAirport(g.lat, g.lon, NEAR_NM);
            st.leg = this.newLeg(ap?.ident ?? null, st.airborneSince, g, [point(g), point(s)]);
            st.phase = "airborne";
            st.airborneSince = null;
            this.note(ap ? `Took off from ${ap.ident}` : `Took off with no airport within ${NEAR_NM} nm`);
            this.emit("track", st.leg.track);
          }
        }
        break;

      case "airborne": {
        const leg = this.ensureLeg(s);
        this.record(leg, s);
        if (s.on_ground) {
          leg.touchdown_at = s.t;
          st.phase = "landed";
          st.stopSince = null;
          // The frame watcher may already have delivered this touchdown on the same sample.
          const recent = leg.landings[leg.landings.length - 1];
          if (!recent || Math.abs(new Date(recent.t).getTime() - s.t) > TOUCHDOWN_MATCH_MS) this.provisionalLanding(leg, s);
          const ap = nearestAirport(s.lat, s.lon, NEAR_NM);
          const last = leg.landings[leg.landings.length - 1];
          this.note(`${ap ? `Landed at ${ap.ident}` : "Landed away from any airport"}: ${last.fpm} fpm, ${last.rating}`);
        }
        break;
      }

      case "landed": {
        const leg = this.ensureLeg(s);
        this.record(leg, s);
        if (!s.on_ground) {
          // Touch-and-go: keep flying the same leg.
          leg.touchdown_at = null;
          st.phase = "airborne";
          st.stopSince = null;
        } else if (s.gs_kts < STOP_KTS) {
          st.stopSince ??= s.t;
          if (s.t - st.stopSince >= STOP_MS) this.complete(s);
        } else {
          st.stopSince = null;
        }
        break;
      }
    }

    if (!s.on_ground) st.lastAirborne = s;
    st.last = s;
    this.save(false);
    this.emitStatus();
  }

  // ------------------------------------------------------------------ internals

  private lookupBinding(title: string, livery: string): number | null {
    const row = bindLookup.get(title, livery, livery) as { id: number } | undefined;
    return row?.id ?? null;
  }

  private newLeg(origin: string | null, departedAt: number, start: SimSample, track: TrackPoint[]): Leg {
    return {
      origin,
      departed_at: departedAt,
      touchdown_at: null,
      track,
      landings: [],
      fuel_start_lb: Math.round(fin(start.fuel_lb)) || null,
      weight_start_lb: Math.round(fin(start.weight_lb)) || null,
      max_alt_ft: Math.round(start.alt_ft),
      max_gs_kts: Math.round(fin(start.gs_kts)),
    };
  }

  private ensureLeg(s: SimSample): Leg {
    if (!this.s.leg) this.s.leg = this.newLeg(null, s.t, s, [point(s)]);
    return this.s.leg;
  }

  private record(leg: Leg, s: SimSample) {
    leg.max_alt_ft = Math.max(leg.max_alt_ft, Math.round(s.alt_ft));
    leg.max_gs_kts = Math.max(leg.max_gs_kts, Math.round(fin(s.gs_kts)));
    const last = leg.track[leg.track.length - 1];
    if (last && s.t - last[3] * 1000 < SAMPLE_MS) return;
    const p = point(s);
    leg.track.push(p);
    this.emit("point", p);
  }

  /** A landing worked out from 1 Hz samples; replaced by the frame watcher's numbers when they arrive. */
  private provisionalLanding(leg: Leg, s: SimSample) {
    const air = this.s.lastAirborne;
    const fpm = Math.round(Math.max(0, -fin(air?.vs_fpm)));
    leg.landings.push({
      t: iso(s.t),
      fpm,
      g: null,
      ias_kts: air ? Math.round(fin(air.ias_kts)) : null,
      sim_fpm: null,
      pitch_deg: null,
      bank_deg: null,
      lat: round(s.lat, 5),
      lon: round(s.lon, 5),
      rating: rateLanding(fpm, null),
      source: "samples",
    });
  }

  private applyTouchdown(leg: Leg, td: Touchdown, s: SimSample) {
    const fpm = Math.round(td.fpm);
    const g = round(td.g, 2);
    const landing: Landing = {
      t: iso(td.t),
      fpm,
      g,
      ias_kts: Math.round(td.ias_kts),
      sim_fpm: td.sim_fpm,
      pitch_deg: td.pitch_deg != null ? round(td.pitch_deg, 1) : null,
      bank_deg: td.bank_deg != null ? round(td.bank_deg, 1) : null,
      lat: round(s.lat, 5),
      lon: round(s.lon, 5),
      rating: rateLanding(fpm, g),
      source: "frames",
    };
    const last = leg.landings[leg.landings.length - 1];
    if (last && last.source === "samples" && Math.abs(new Date(last.t).getTime() - td.t) <= TOUCHDOWN_MATCH_MS) {
      leg.landings[leg.landings.length - 1] = landing;
    } else {
      leg.landings.push(landing);
    }
    this.note(`Touchdown ${fpm} fpm, ${g.toFixed(2)} G: ${landing.rating}`);
  }

  /** Close the current leg at sample `s` (where the aircraft stopped) and log or park it. */
  private complete(s: SimSample) {
    const st = this.s;
    const leg = st.leg;
    if (!leg) return;
    const touchdown = leg.touchdown_at ?? s.t;
    const last = leg.track[leg.track.length - 1];
    const p = point(s);
    if (!last || last[3] !== p[3]) leg.track.push(p);

    st.leg = null;
    st.phase = "ground";
    st.lastGround = s;
    st.airborneSince = null;
    st.stopSince = null;
    this.emit("track", []);

    const durationMin = Math.round((touchdown - leg.departed_at) / 60000);
    if (durationMin < MIN_LEG_MIN) {
      this.note("Dropped a leg under a minute long");
      this.save(true);
      return;
    }

    const fuelEnd = Math.round(fin(s.fuel_lb)) || null;
    const stats: HopStats = {
      fuel_start_lb: leg.fuel_start_lb,
      fuel_end_lb: fuelEnd,
      fuel_used_lb: leg.fuel_start_lb != null && fuelEnd != null ? leg.fuel_start_lb - fuelEnd : null,
      weight_start_lb: leg.weight_start_lb,
      weight_end_lb: Math.round(fin(s.weight_lb)) || null,
      max_alt_ft: leg.max_alt_ft,
      max_gs_kts: leg.max_gs_kts,
      flown_nm: trackNm(leg.track),
    };
    const dest = nearestAirport(s.lat, s.lon, NEAR_NM)?.ident ?? null;
    const aircraftId = st.aircraft_id && aircraftExists.get(st.aircraft_id) ? st.aircraft_id : null;
    const briefingId = st.briefing?.id ?? null;
    st.briefing = null;
    const draft = {
      origin: leg.origin,
      dest,
      departed_at: iso(leg.departed_at),
      arrived_at: iso(touchdown),
      duration_min: durationMin,
      track: leg.track,
      landings: leg.landings,
      stats,
      briefing_id: briefingId,
    };
    const reason = !aircraftId
      ? "no fleet aircraft is bound to this sim aircraft"
      : !leg.origin
        ? "the departure airport is unknown"
        : !dest
          ? `no airport within ${NEAR_NM} nm of where it stopped`
          : null;

    if (!reason) {
      const hop = insertHop(aircraftId!, draft as HopDraft);
      const landing = leg.landings[leg.landings.length - 1];
      this.note(`Logged ${draft.origin} → ${dest}, ${fmtMin(durationMin)}${landing ? `, ${landing.fpm} fpm ${landing.rating}` : ""}`);
      this.emit("hop", hop);
    } else {
      st.pending = { sim: st.sim ?? { title: s.title, livery: s.livery, atc_id: s.atc_id }, aircraft_id: aircraftId, ...draft, reason };
      this.note(`Leg ${draft.origin ?? "?"} → ${dest ?? "?"} (${fmtMin(durationMin)}) needs details: ${reason}`);
      this.emit("pending", st.pending);
    }
    this.save(true);
  }

  private note(message: string) {
    this.s.message = message;
    this.s.message_at = new Date().toISOString();
    console.log(`[tracker] ${message}`);
  }

  private save(force: boolean) {
    const now = Date.now();
    if (!force && now - this.lastSave < SAVE_MS) return;
    this.lastSave = now;
    saveStmt.run(JSON.stringify(this.s), new Date().toISOString());
  }

  private emitStatus() {
    this.emit("status", this.status());
  }
}

export const tracker = new Tracker();
