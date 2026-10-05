import { EventEmitter } from "node:events";
import { db } from "./db.ts";
import { distanceNm, nearestAirport } from "./airports.ts";
import type { SimAircraft, SimSample } from "./simconnect.ts";

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
 * A finished leg is logged straight into `hops` (with its track) when the sim aircraft is bound to
 * a fleet row and both airports are known; otherwise it is parked as `pending` for the user to
 * complete from the UI.
 */

/** [lat, lon, alt_ft, unix_seconds]: the sample shape stored in hops.track. */
export type TrackPoint = [number, number, number, number];
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

interface Leg {
  origin: string | null;
  /** Takeoff, epoch ms. */
  departed_at: number;
  /** Most recent touchdown, epoch ms; cleared again by a touch-and-go. */
  touchdown_at: number | null;
  track: TrackPoint[];
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
  /** Why it was not logged automatically. */
  reason: string;
}

interface Persisted {
  phase: Phase;
  sim: SimAircraft | null;
  aircraft_id: number | null;
  leg: Leg | null;
  pending: PendingLeg | null;
  last: SimSample | null;
  lastGround: SimSample | null;
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
  position: { lat: number; lon: number; alt_ft: number; gs_kts: number; hdg_deg: number; on_ground: boolean; t: string } | null;
  leg: { origin: string | null; departed_at: string; touchdown_at: string | null; points: number } | null;
  pending: (Omit<PendingLeg, "track"> & { points: number }) | null;
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
  created_at: string;
}

const EMPTY: Persisted = {
  phase: "idle",
  sim: null,
  aircraft_id: null,
  leg: null,
  pending: null,
  last: null,
  lastGround: null,
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
  `INSERT INTO hops (aircraft_id, seq, origin, dest, departed_at, arrived_at, duration_min, notes, track)
   VALUES (?,?,?,?,?,?,?,?,?)`,
);
const hopGet = db.prepare(`SELECT * FROM hops WHERE id = ?`);

function load(): Persisted {
  const row = loadStmt.get() as { json: string } | undefined;
  if (!row) return { ...EMPTY };
  try {
    return { ...EMPTY, ...(JSON.parse(row.json) as Partial<Persisted>) };
  } catch {
    return { ...EMPTY };
  }
}

const iso = (ms: number) => new Date(ms).toISOString();
const round = (v: number, places: number) => Number(v.toFixed(places));
const point = (s: SimSample): TrackPoint => [round(s.lat, 5), round(s.lon, 5), Math.round(s.alt_ft), Math.round(s.t / 1000)];

function fmtMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} h ${m.toString().padStart(2, "0")} min` : `${m} min`;
}

interface HopDraft {
  origin: string;
  dest: string;
  departed_at: string;
  arrived_at: string;
  duration_min: number;
  track: TrackPoint[];
}

function insertHop(aircraftId: number, h: HopDraft): LoggedHop {
  const seq = (nextSeq.get(aircraftId) as { s: number }).s;
  const r = insertHopStmt.run(aircraftId, seq, h.origin, h.dest, h.departed_at, h.arrived_at, h.duration_min, "", JSON.stringify(h.track));
  return hopGet.get(Number(r.lastInsertRowid)) as unknown as LoggedHop;
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
            alt_ft: Math.round(l.alt_ft),
            gs_kts: Math.round(l.gs_kts),
            hdg_deg: Math.round(l.hdg_deg),
            on_ground: l.on_ground,
            t: iso(l.t),
          }
        : null,
      leg: st.leg
        ? {
            origin: st.leg.origin,
            departed_at: iso(st.leg.departed_at),
            touchdown_at: st.leg.touchdown_at ? iso(st.leg.touchdown_at) : null,
            points: st.leg.track.length,
          }
        : null,
      pending: st.pending ? { ...(pendingRest as Omit<PendingLeg, "track">), points: pendingTrack.length } : null,
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
    const hop = insertHop(aircraftId, { origin, dest, departed_at: p.departed_at, arrived_at: p.arrived_at, duration_min: p.duration_min, track: p.track });
    this.s.pending = null;
    this.note(`Logged ${origin} → ${dest}, ${fmtMin(p.duration_min)}`);
    this.emit("hop", hop);
    this.save(true);
    this.emitStatus();
    return hop;
  }

  discardPending(): void {
    if (!this.s.pending) return;
    this.s.pending = null;
    this.note("Discarded the unlogged leg");
    this.save(true);
    this.emitStatus();
  }

  // ------------------------------------------------------------------ samples

  feed(s: SimSample): void {
    const st = this.s;
    if (!this.simRunning || this.paused) {
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
        st.airborneSince = null;
        st.stopSince = null;
      }
    }

    switch (st.phase) {
      case "idle":
        if (s.on_ground) {
          st.phase = "ground";
          st.lastGround = s;
        } else {
          st.phase = "airborne";
          st.leg = { origin: null, departed_at: s.t, touchdown_at: null, track: [point(s)] };
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
            st.leg = { origin: ap?.ident ?? null, departed_at: st.airborneSince, touchdown_at: null, track: [point(g), point(s)] };
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
          const ap = nearestAirport(s.lat, s.lon, NEAR_NM);
          this.note(ap ? `Landed at ${ap.ident}` : "Landed away from any airport");
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

    st.last = s;
    this.save(false);
    this.emitStatus();
  }

  // ------------------------------------------------------------------ internals

  private lookupBinding(title: string, livery: string): number | null {
    const row = bindLookup.get(title, livery, livery) as { id: number } | undefined;
    return row?.id ?? null;
  }

  private ensureLeg(s: SimSample): Leg {
    if (!this.s.leg) this.s.leg = { origin: null, departed_at: s.t, touchdown_at: null, track: [point(s)] };
    return this.s.leg;
  }

  private record(leg: Leg, s: SimSample) {
    const last = leg.track[leg.track.length - 1];
    if (last && s.t - last[3] * 1000 < SAMPLE_MS) return;
    const p = point(s);
    leg.track.push(p);
    this.emit("point", p);
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

    const dest = nearestAirport(s.lat, s.lon, NEAR_NM)?.ident ?? null;
    const aircraftId = st.aircraft_id && aircraftExists.get(st.aircraft_id) ? st.aircraft_id : null;
    const draft = { origin: leg.origin, dest, departed_at: iso(leg.departed_at), arrived_at: iso(touchdown), duration_min: durationMin, track: leg.track };
    const reason = !aircraftId
      ? "no fleet aircraft is bound to this sim aircraft"
      : !leg.origin
        ? "the departure airport is unknown"
        : !dest
          ? `no airport within ${NEAR_NM} nm of where it stopped`
          : null;

    if (!reason) {
      const hop = insertHop(aircraftId!, draft as HopDraft);
      this.note(`Logged ${draft.origin} → ${dest}, ${fmtMin(durationMin)}`);
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
