import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { db, transaction } from "./db.ts";
import { distanceNm, nearestAirport } from "./airports.ts";
import { currentInputs } from "./inputs.ts";
import type { SimAircraft, SimSample, Touchdown } from "./simconnect.ts";
import type { BriefingSummary } from "./ofp.ts";

/**
 * Turns a stream of position samples from the sim into logged hops.
 *
 * Phases: idle → ground → airborne → landed → (hop logged) → ground. A takeoff is the on-ground
 * flag staying false for TAKEOFF_CONFIRM_MS; a landing is the flag coming back on, and the hop
 * closes once the aircraft has sat below STOP_KTS for STOP_MS (so a touch-and-go stays inside
 * one hop). Origin and destination are the nearest airports to where the wheels left and where
 * the aircraft stopped. The whole state is checkpointed to `tracker_state` so a server restart
 * mid-flight loses nothing; a leg restored in the air goes on only when the sim's first sample
 * shows the same flight still flying.
 *
 * Each touchdown is rated from its descent rate and peak G (see rateLanding). The frame-rate
 * watcher in simconnect.ts supplies accurate numbers a moment after the wheels touch; until then
 * (and always with the fake feed) a provisional landing is derived from the 1 Hz samples.
 *
 * A finished leg is logged straight into `hops` (with track, landings, stats and any SimBrief
 * briefing imported for it), in one transaction with the checkpoint that no longer holds it, when
 * the sim aircraft is bound to a fleet row and both airports are known; otherwise it joins the
 * list of pending legs, each with an id of its own, for the user to complete from the UI. A leg
 * in the air when the sim's connection ends is kept as pending too, marked as ended in the air.
 *
 * Casual mode suspends all of that: no legs, only a path of the samples flown, broken into
 * segments at a jump, a new flight or a disconnect. Its switch is checkpointed; its path is kept
 * in memory only.
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
/** On the ground below this, the aircraft is standing still and adds nothing to the casual path. */
const STILL_KTS = 1;

/** Why a leg in the air was kept as pending. */
const DISCONNECTED = "the sim disconnected in flight";
const NOT_RESUMED = "MSFS Career Map stopped in flight and the sim did not resume it";

/** The farthest a sample may lie from the one `gapMs` before it and still be the same flight. */
const jumpBoundNm = (gapMs: number) => TELEPORT_NM + (Math.max(0, gapMs) / 3600000) * 700;

// ------------------------------------------------------------------ landings

export type LandingRating = "butter" | "solid" | "hard" | "hospital" | "graveyard";
const RATINGS: LandingRating[] = ["butter", "solid", "hard", "hospital", "graveyard"];
/** Upper bound of descent rate (fpm) for each rating; the last is open-ended. */
const FPM_LIMITS = [100, 250, 500, 800];
/** Upper bound of peak G for each rating. A hard G floor bumps a gentle-looking fpm up a class. */
const G_LIMITS = [1.6, 2.0, 2.6, 3.5];

/** A touchdown less than this after the previous one is a bounce within the same landing. */
const BOUNCE_MS = 30_000;

/**
 * The touchdown that stands for a leg: the first touchdown of its final landing. The browser
 * shows hops by the same rule (shownTouchdown in src/client/landing.ts); keep the two in step.
 */
function shownTouchdown(landings: Landing[]): Landing | null {
  let i = landings.length - 1;
  if (i < 0) return null;
  while (i > 0 && Date.parse(landings[i].t) - Date.parse(landings[i - 1].t) < BOUNCE_MS) i--;
  return landings[i];
}

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
  /** A random UUID, unique for the life of the logbook and kept with the leg in the checkpoint. */
  id: string;
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
  /** Kept while airborne (a disconnect in flight, a restored leg not resumed) rather than closed after landing. */
  ended_in_air: boolean;
}

/** A pending leg as the status and the `pending` event list it: no track, its point count instead. */
export type PendingLegStatus = Omit<PendingLeg, "track"> & { points: number };

/** How the server reaches the sim: the sim link, the fake feed, or not at all. */
export type SimMode = "link" | "fake" | "off";

/** Another server holding the PC-wide sim-link claim, with the words the card shows for it. */
export interface LinkHolder {
  holder: "installed" | "source" | null;
  data_folder: string | null;
  text: string;
}

/** The tracker's state as it runs. Casual mode is held apart, with its path (Casual). */
interface State {
  phase: Phase;
  sim: SimAircraft | null;
  aircraft_id: number | null;
  leg: Leg | null;
  /** Legs waiting for details, oldest first. */
  pending: PendingLeg[];
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

/** The checkpoint: the state with casual mode's switch and the time it went on (epoch ms), never its path. */
interface Persisted extends State {
  casual: { since: number } | null;
}

export interface TrackerStatus {
  connected: boolean;
  sim_name: string | null;
  /** How the server reaches the sim; "off" until the server says otherwise. */
  sim_mode: SimMode;
  /** The host of a sim on another PC the link reaches; null for this PC or no link. */
  sim_host: string | null;
  /** Another server holding the sim-link claim; null unless one does. */
  link_holder: LinkHolder | null;
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
  /** In the order kept, oldest first; empty when none waits. */
  pending: PendingLegStatus[];
  briefing: BriefingSummary | null;
  /** Casual mode: when it was switched on and the path's points over all segments; null while off. */
  casual: { since: string; points: number } | null;
  message: string | null;
  message_at: string | null;
}

/** Casual mode's own state: the switch and its time are checkpointed, the path never is. */
interface Casual {
  since: number;
  path: TrackPoint[][];
  /** The next point begins a new segment (after a jump, a new flight or a disconnect). */
  breakPending: boolean;
}

/** Switching casual mode on would drop a fleet aircraft's airborne leg, and the request did not say to. */
export class CasualRefused extends Error {
  constructor(public details: { aircraft_id: number; name: string; origin: string | null; departed_at: string }) {
    super(
      `${details.name} is flying a leg ${details.origin ? `from ${details.origin}` : "that started in the air"}; ` +
        "switching to casual mode would drop it",
    );
  }
}

/** A user action the tracker turns down as asked: the request is at fault, not the server. */
export class TrackerRefused extends Error {}

/** A pilot's action that comes after the final checkpoint: nothing may change the state any more. */
export class ShuttingDown extends Error {
  constructor() {
    super("MSFS Career Map is shutting down");
  }
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

/** Payload of the tracker's "hop" event: the hop logged and the tracker's message for it. */
export interface HopEvent {
  hop: LoggedHop;
  message: string;
}

/** The state of a tracker that has seen nothing. */
const emptyState = (): State => ({
  phase: "idle",
  sim: null,
  aircraft_id: null,
  leg: null,
  pending: [],
  briefing: null,
  last: null,
  lastGround: null,
  lastAirborne: null,
  airborneSince: null,
  stopSince: null,
  message: null,
  message_at: null,
});

const emptyStats = (): HopStats => ({
  fuel_start_lb: null,
  fuel_end_lb: null,
  fuel_used_lb: null,
  weight_start_lb: null,
  weight_end_lb: null,
  max_alt_ft: null,
  max_gs_kts: null,
  flown_nm: null,
});

const loadStmt = db.prepare(`SELECT json FROM tracker_state WHERE id = 1`);
const saveStmt = db.prepare(
  `INSERT INTO tracker_state (id, json, updated_at) VALUES (1, ?, ?)
   ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
);
const setAsideStmt = db.prepare(`INSERT INTO tracker_state_aside (json, set_aside_at) VALUES (?, ?)`);
const bindLookup = db.prepare(
  `SELECT id FROM aircraft WHERE sim_title = ? AND (sim_livery = ? OR sim_livery IS NULL OR sim_livery = '')
   ORDER BY (sim_livery = ?) DESC, id LIMIT 1`,
);
const bindSet = db.prepare(`UPDATE aircraft SET sim_title = ?, sim_livery = ? WHERE id = ?`);
const aircraftExists = db.prepare(`SELECT id FROM aircraft WHERE id = ?`);
const aircraftName = db.prepare(`SELECT name, livery FROM aircraft WHERE id = ?`);
const nextSeq = db.prepare(`SELECT COALESCE(MAX(seq),0)+1 AS s FROM hops WHERE aircraft_id = ?`);
const insertHopStmt = db.prepare(
  `INSERT INTO hops (aircraft_id, seq, origin, dest, departed_at, arrived_at, duration_min, notes, track, landings, stats, briefing_id)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
);
const hopGet = db.prepare(`SELECT * FROM hops WHERE id = ?`);
const briefingAttach = db.prepare(`UPDATE briefings SET hop_id = ?, aircraft_id = ? WHERE id = ?`);
const briefingDropUnused = db.prepare(`DELETE FROM briefings WHERE id = ? AND hop_id IS NULL`);

// ------------------------------------------------------------------ restoring

const PHASES: readonly string[] = ["idle", "ground", "airborne", "landed"];
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNumber = (v: unknown) => typeof v === "number";
const isString = (v: unknown) => typeof v === "string";
const isSample = (v: unknown) => isObject(v) && isNumber(v.t) && isNumber(v.lat) && isNumber(v.lon);

const isSim = (v: unknown) => isObject(v) && isString(v.title) && isString(v.livery);

/** A track point: at least [lat, lon, alt_ft, unix_seconds] (0.7 rows have only those), every entry a finite number. */
const isPoint = (v: unknown) => Array.isArray(v) && v.length >= 4 && v.every((x) => typeof x === "number" && Number.isFinite(x));
/** A list of track points. */
const isTrack = (v: unknown) => Array.isArray(v) && v.every(isPoint);
/** A list of touchdowns, each with the time every reader of a leg's landings goes by. */
const isLandings = (v: unknown) => Array.isArray(v) && v.every((l) => isObject(l) && isString(l.t));

/** The first field of `v` that is present and not null but fails its shape, or undefined. */
const misshapen = (v: Record<string, unknown>, shapes: [string, (x: unknown) => boolean][]) =>
  shapes.find(([k, ok]) => v[k] != null && !ok(v[k]))?.[0];

/**
 * The shape each field of the checkpoint itself must have when it is present and not null. The leg
 * in progress and each pending leg are judged on their own (legProblem, pendingProblem).
 */
const FIELD_SHAPES: [string, (v: unknown) => boolean][] = [
  ["sim", isSim],
  ["aircraft_id", isNumber],
  // A list of legs, or the single leg an older version kept.
  ["pending", (v) => Array.isArray(v) || isObject(v)],
  ["briefing", (v) => isObject(v) && isNumber(v.id)],
  ["casual", (v) => isObject(v) && isNumber(v.since)],
  ["last", isSample],
  ["lastGround", isSample],
  ["lastAirborne", isSample],
  ["airborneSince", isNumber],
  ["stopSince", isNumber],
  ["message", isString],
  ["message_at", isString],
];

/** Why a parsed checkpoint cannot be read, or null when it can. Fields this version does not know never count. */
function unreadable(v: unknown): string | null {
  if (!isObject(v)) return "it is not a JSON object";
  if (typeof v.phase !== "string" || !PHASES.includes(v.phase)) return "its phase is missing or unknown";
  const bad = misshapen(v, FIELD_SHAPES);
  return bad ? `its ${bad} has the wrong type` : null;
}

/** The leg in progress's fields this version needs, and those it reads when present and not null. */
const LEG_NEEDS: [string, (v: unknown) => boolean][] = [
  ["departed_at", isNumber],
  ["track", isTrack],
];
const LEG_SHAPES: [string, (v: unknown) => boolean][] = [
  ["landings", isLandings],
  ["origin", isString],
  ["touchdown_at", isNumber],
  ["fuel_start_lb", isNumber],
  ["weight_start_lb", isNumber],
  ["max_alt_ft", isNumber],
  ["max_gs_kts", isNumber],
];

/** Why a saved leg in progress cannot be read, or null when it can. */
function legProblem(v: unknown): string | null {
  if (!isObject(v)) return "it is not an object";
  const missing = LEG_NEEDS.find(([k, ok]) => !ok(v[k]))?.[0];
  if (missing) return `its ${missing} is missing or has the wrong type`;
  const bad = misshapen(v, LEG_SHAPES);
  return bad ? `its ${bad} has the wrong type` : null;
}

/** A pending leg's fields this version needs, and those it reads when present and not null. */
const PENDING_NEEDS: [string, (v: unknown) => boolean][] = [
  ["sim", isSim],
  ["departed_at", isString],
  ["arrived_at", isString],
  ["duration_min", isNumber],
  ["reason", isString],
];
const PENDING_SHAPES: [string, (v: unknown) => boolean][] = [
  ["track", isTrack],
  ["landings", isLandings],
  ["stats", isObject],
  ["ended_in_air", (v) => typeof v === "boolean"],
];

/** Why a saved pending leg cannot be read, or null when it can. */
function pendingProblem(v: unknown): string | null {
  if (!isObject(v)) return "it is not an object";
  const missing = PENDING_NEEDS.find(([k, ok]) => !ok(v[k]))?.[0];
  if (missing) return `its ${missing} is missing or has the wrong type`;
  const bad = misshapen(v, PENDING_SHAPES);
  return bad ? `its ${bad} has the wrong type` : null;
}

/** A part of a readable checkpoint that cannot be read itself, to be set aside alone. */
interface AsidePart {
  part: unknown;
  /** The line written for it, once it has been set aside. */
  line: string;
}

interface Restored {
  state: State;
  casual: { since: number } | null;
  /** The checkpoint was brought up to date while being read (a pending leg given its id) and must be written back. */
  migrated: boolean;
  /** Parts set aside alone; the checkpoint is written back without them, in one transaction with their rows. */
  aside: AsidePart[];
}

/**
 * The checkpoint as this version runs it. A field this version does not know rides along on the
 * object holding it, so every save writes it back. One it cannot read as a whole is set aside
 * whole, in `tracker_state_aside`, and replaced by the empty state at once. A leg in progress or a
 * pending leg it cannot read is only collected here, to be set aside alone by the constructor.
 */
// @spec LIVE-SAVE-002, LIVE-SAVE-007, LIVE-SAVE-012, LIVE-SAVE-013, LIVE-SAVE-014
function load(): Restored {
  const row = loadStmt.get() as { json: string } | undefined;
  if (!row) return { state: emptyState(), casual: null, migrated: false, aside: [] };
  let raw: unknown;
  let problem: string | null = null;
  try {
    raw = JSON.parse(row.json);
  } catch {
    problem = "it is not JSON";
  }
  problem ??= unreadable(raw);
  if (problem) {
    const now = new Date().toISOString();
    const empty: Persisted = { ...emptyState(), casual: null };
    transaction(() => {
      setAsideStmt.run(row.json, now);
      saveStmt.run(JSON.stringify(empty), now);
    });
    console.error(`[tracker] set aside a checkpoint it cannot read (${problem}) in tracker_state_aside; starting empty`);
    return { state: emptyState(), casual: null, migrated: false, aside: [] };
  }

  const { casual, pending, ...rest } = raw as Record<string, unknown>;
  const state: State = { ...emptyState(), ...(rest as Partial<State>) };
  const aside: AsidePart[] = [];

  // A leg in progress it cannot read goes alone, and with it everything that belonged to the leg:
  // tracking begins afresh from idle with the next sample.
  const legBad = state.leg != null ? legProblem(state.leg) : null;
  if (legBad) {
    aside.push({ part: state.leg, line: `[tracker] set aside the leg in progress it cannot read (${legBad}) in tracker_state_aside; tracking starts afresh` });
    Object.assign(state, { leg: null, phase: "idle", airborneSince: null, stopSince: null, lastGround: null, lastAirborne: null });
  }

  // A leg checkpointed by an older version lacks the landing/stat fields; a field saved as null gets its default.
  if (state.leg) {
    const l = state.leg;
    state.leg = {
      ...l,
      origin: l.origin ?? null,
      touchdown_at: l.touchdown_at ?? null,
      landings: l.landings ?? [],
      fuel_start_lb: l.fuel_start_lb ?? null,
      weight_start_lb: l.weight_start_lb ?? null,
      max_alt_ft: l.max_alt_ft ?? 0,
      max_gs_kts: l.max_gs_kts ?? 0,
    };
    // A leg that began at the main menu's null-island position is not a flight.
    const first = state.leg.track[0];
    if (first && !isRealPosition({ lat: first[0], lon: first[1], alt_ft: first[2] })) {
      console.log("[tracker] dropped a checkpointed leg that started at the sim's menu position");
      state.leg = null;
      state.phase = "idle";
    }
  }

  // An older version kept a single pending leg, or null, in place of the list. Each leg it cannot
  // read goes alone; the others keep their order and their ids.
  const entries: unknown[] = Array.isArray(pending) ? pending : pending != null ? [pending] : [];
  let migrated = entries.length > 0 && !Array.isArray(pending);
  const legs: Partial<PendingLeg>[] = [];
  for (const e of entries) {
    const bad = pendingProblem(e);
    if (bad) aside.push({ part: e, line: `[tracker] set aside a pending leg it cannot read (${bad}) in tracker_state_aside` });
    else legs.push(e as Partial<PendingLeg>);
  }
  state.pending = legs.map((l) => {
    if (typeof l.id !== "string") migrated = true;
    return {
      ...l,
      id: typeof l.id === "string" ? l.id : randomUUID(),
      aircraft_id: l.aircraft_id ?? null,
      origin: l.origin ?? null,
      dest: l.dest ?? null,
      track: l.track ?? [],
      landings: l.landings ?? [],
      stats: l.stats ?? emptyStats(),
      briefing_id: l.briefing_id ?? null,
      // A leg saved before the mark existed ended in the air exactly when it was kept for one of these reasons.
      ended_in_air: l.ended_in_air ?? (l.reason === DISCONNECTED || l.reason === NOT_RESUMED),
    } as PendingLeg;
  });

  return { state, casual: isObject(casual) ? { since: casual.since as number } : null, migrated, aside };
}

// ------------------------------------------------------------------ helpers

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

/** The track ending at sample `s`: a copy with its point added, unless a point at that second is already last. */
function withPoint(track: TrackPoint[], s: SimSample): TrackPoint[] {
  const last = track[track.length - 1];
  const p = point(s);
  return !last || last[3] !== p[3] ? [...track, p] : track;
}

function fmtMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} h ${m.toString().padStart(2, "0")} min` : `${m} min`;
}

/** What the tracker reports for a hop it logs, from a closed leg or a pending one alike. */
// @spec LIVE-HOP-006
function loggedMessage(origin: string, dest: string, durationMin: number, landings: Landing[]): string {
  const landing = shownTouchdown(landings);
  return `Logged ${origin} → ${dest}, ${fmtMin(durationMin)}${landing ? `, ${landing.fpm} fpm ${landing.rating}` : ""}`;
}

function trackNm(track: TrackPoint[]): number {
  let nm = 0;
  for (let i = 1; i < track.length; i++) nm += distanceNm(track[i - 1][0], track[i - 1][1], track[i][0], track[i][1]);
  return round(nm, 1);
}

/** A leg's statistics over `track`, ending at sample `end` (null when none is known). */
function legStats(leg: Leg, track: TrackPoint[], end: SimSample | null): HopStats {
  const fuelEnd = end ? Math.round(fin(end.fuel_lb)) || null : null;
  return {
    fuel_start_lb: leg.fuel_start_lb,
    fuel_end_lb: fuelEnd,
    fuel_used_lb: leg.fuel_start_lb != null && fuelEnd != null ? leg.fuel_start_lb - fuelEnd : null,
    weight_start_lb: leg.weight_start_lb,
    weight_end_lb: end ? Math.round(fin(end.weight_lb)) || null : null,
    max_alt_ft: leg.max_alt_ft,
    max_gs_kts: leg.max_gs_kts,
    flown_nm: trackNm(track),
  };
}

/** A pending leg's own fields; any this version does not know stay in the checkpoint only. */
function known(p: PendingLeg): PendingLeg {
  return {
    id: p.id,
    sim: p.sim,
    aircraft_id: p.aircraft_id,
    origin: p.origin,
    dest: p.dest,
    departed_at: p.departed_at,
    arrived_at: p.arrived_at,
    duration_min: p.duration_min,
    track: p.track,
    landings: p.landings,
    stats: p.stats,
    briefing_id: p.briefing_id,
    reason: p.reason,
    // @spec LIVE-HOP-007
    ended_in_air: p.ended_in_air,
  };
}

/** A pending leg as the status and the `pending` event list it. */
function listed(p: PendingLeg): PendingLegStatus {
  const { track, ...rest } = known(p);
  return { ...rest, points: track.length };
}

const LINKED_ELSEWHERE = "The sim is linked to another copy";
const linkHolderText = (holder: LinkHolder["holder"]) =>
  holder === "installed" ? `${LINKED_ELSEWHERE} (the installed app)` : holder === "source" ? `${LINKED_ELSEWHERE} (run from source)` : LINKED_ELSEWHERE;

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
  private s: State;
  private casual: Casual | null;
  /** A leg restored in the air, until the sim's first sample shows whether it goes on. Never checkpointed. */
  private restoredInAir: Leg | null;
  /** Set by shutdown: no sample or sim event is taken after the final checkpoint. */
  private stopped = false;
  private lastSave = 0;
  private simMode: SimMode = "off";
  private simHost: string | null = null;
  private linkHolder: LinkHolder | null = null;
  connected = false;
  simName: string | null = null;
  simRunning = true;
  paused = false;
  liverySupported = true;

  /**
   * Restore the checkpoint. Casual mode comes back as it holds it, with an empty path, except on a
   * fresh run, which starts it off and writes that before returning. A part it cannot read is set
   * aside alone, its row and the checkpoint without it written in one transaction before returning.
   */
  // @spec LIVE-CASUAL-011, LIVE-CASUAL-015, LIVE-SAVE-013, LIVE-SAVE-014
  constructor(opts: { freshRun?: boolean } = {}) {
    super();
    const { state, casual, migrated, aside } = load();
    this.s = state;
    const on = opts.freshRun ? null : casual;
    this.casual = on ? { since: on.since, path: [], breakPending: false } : null;
    this.restoredInAir = state.leg && state.phase === "airborne" ? state.leg : null;
    if (aside.length) {
      const at = new Date().toISOString();
      transaction(() => {
        for (const a of aside) setAsideStmt.run(JSON.stringify(a.part), at);
        this.write();
      });
      for (const a of aside) console.error(a.line);
    } else if (migrated || opts.freshRun) {
      this.write();
    }
  }

  // ------------------------------------------------------------------ status

  // @spec LIVE-API-001, LIVE-API-013
  status(): TrackerStatus {
    const st = this.s;
    const l = st.last;
    const leg = st.leg;
    return {
      connected: this.connected,
      sim_name: this.simName,
      sim_mode: this.simMode,
      sim_host: this.simHost,
      link_holder: this.linkHolder,
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
      pending: st.pending.map(listed),
      briefing: st.briefing,
      // @spec LIVE-API-010
      casual: this.casual
        ? { since: iso(this.casual.since), points: this.casual.path.reduce((n, seg) => n + seg.length, 0) }
        : null,
      message: st.message,
      message_at: st.message_at,
    };
  }

  /** The in-progress leg's recorded points (empty when nothing is being flown). */
  track(): TrackPoint[] {
    return this.s.leg?.track ?? [];
  }

  /** The casual path's segments (empty while casual mode is off). */
  path(): TrackPoint[][] {
    return this.casual?.path ?? [];
  }

  inCasualMode(): boolean {
    return this.casual != null;
  }

  /** That pending leg in full, its track included, or null. */
  // @spec LIVE-API-007
  pendingLeg(id: string): PendingLeg | null {
    const p = this.s.pending.find((x) => x.id === id);
    return p ? known(p) : null;
  }

  // ------------------------------------------------------------------ server

  /** How the server reaches the sim, and the host of a sim on another PC (null for this PC or no link). */
  // @spec LIVE-API-013
  setSimMode(mode: SimMode, host: string | null = null): void {
    this.simMode = mode;
    this.simHost = host;
    this.emitStatus();
  }

  /** Another server holding the PC-wide sim-link claim, as it describes itself; null when none does. */
  // @spec LIVE-API-013
  setLinkHolder(h: { holder: LinkHolder["holder"]; data_folder: string | null } | null): void {
    this.linkHolder = h ? { holder: h.holder, data_folder: h.data_folder, text: linkHolderText(h.holder) } : null;
    this.emitStatus();
  }

  /**
   * Write the whole state to the checkpoint now and change nothing else (the server's save request).
   * After the final checkpoint it writes nothing.
   */
  // @spec LIVE-SAVE-004, LIVE-SAVE-005
  saveNow(): void {
    if (this.stopped) return;
    this.write();
  }

  /**
   * The final checkpoint, written once the server has stopped the sim link. When the app is
   * quitting, casual mode is switched off first. No sample or sim event is taken afterwards, and
   * every pilot's action that would change the state throws ShuttingDown.
   */
  // @spec LIVE-SAVE-005, LIVE-CASUAL-013
  shutdown(opts: { quitting: boolean }): void {
    this.stopped = true;
    if (opts.quitting && this.casual) {
      this.casual = null;
      this.emit("path", []);
      this.emitStatus();
    }
    this.write();
  }

  /** Whether the final checkpoint has been written (shutdown has run). */
  // @spec LIVE-SAVE-005, LIVE-API-016
  isShutDown(): boolean {
    return this.stopped;
  }

  /**
   * Turn down a pilot's action once the final checkpoint is written, before it looks at anything:
   * bind, setBriefing, setCasual, discardLeg, completeNow, savePending and discardPending.
   */
  // @spec LIVE-SAVE-005
  private refuseAfterShutdown(): void {
    if (this.stopped) throw new ShuttingDown();
  }

  // ------------------------------------------------------------------ link events

  /**
   * The sim link connected, or its connection ended: `quit` is SimConnect's quit event (MSFS closed
   * normally); anything else is a crash, a close or a failure. A leg in the air is kept as pending,
   * a restored one still waiting for the sim's first sample with the reason that it was not resumed.
   */
  // @spec LIVE-LEG-008, LIVE-CASUAL-014
  setConnected(v: boolean, name: string | null = null, opts: { quit?: boolean } = {}) {
    if (this.stopped) return;
    this.connected = v;
    this.simName = v ? name : null;
    if (!v) {
      this.simRunning = true;
      this.paused = false;
      if (this.casual && opts.quit) {
        this.casual = null;
        this.note("Casual mode off (MSFS closed): takeoffs and landings are logged again");
        this.emit("path", []);
        this.save(true);
      } else if (this.casual) {
        this.casual.breakPending = true;
      }
      // @spec LIVE-LEG-016
      if (this.takeRestoredInAir()) this.keepLeg(NOT_RESUMED);
      else if (this.s.leg) {
        if (this.s.phase === "landed" && this.s.last) this.complete(this.s.last);
        else this.keepLeg(DISCONNECTED);
      }
    }
    this.emitStatus();
  }

  setPaused(v: boolean) {
    if (this.stopped) return;
    this.paused = v;
    this.emitStatus();
  }

  setSimRunning(v: boolean) {
    if (this.stopped) return;
    this.simRunning = v;
    this.emitStatus();
  }

  setLiverySupported(v: boolean) {
    if (this.stopped) return;
    this.liverySupported = v;
    this.emitStatus();
  }

  /**
   * A new flight was loaded: a landed leg closes at the last sample, as for any interruption after
   * landing; an airborne one is discarded, unless it is a restored leg still waiting for the sim.
   */
  // @spec LIVE-LEG-010, LIVE-LEG-011
  flightLoaded(_file: string) {
    if (this.stopped) return;
    if (this.casual) this.casual.breakPending = true;
    const st = this.s;
    // @spec LIVE-LEG-016
    if (this.takeRestoredInAir()) {
      this.keepLeg(NOT_RESUMED);
      this.emitStatus();
    } else if (st.leg && st.phase === "landed" && st.last) {
      this.complete(st.last);
      this.emitStatus();
    } else if (st.leg && st.phase === "airborne") {
      this.discardLeg("a new flight was loaded");
    }
  }

  // ------------------------------------------------------------------ user actions

  /**
   * Bind the sim aircraft currently being flown to a fleet row (and remember the pairing), and set
   * that aircraft on every pending leg flown in the same title and livery that has none.
   */
  // @spec LIVE-BIND-003
  bind(aircraftId: number): void {
    this.refuseAfterShutdown();
    const st = this.s;
    const sim = st.sim;
    if (!sim) throw new TrackerRefused("no sim aircraft to bind yet");
    if (!aircraftExists.get(aircraftId)) throw new TrackerRefused(`aircraft ${aircraftId} not found`);
    bindSet.run(sim.title, sim.livery, aircraftId);
    st.aircraft_id = aircraftId;
    for (const p of st.pending) {
      if (p.aircraft_id == null && p.sim?.title === sim.title && p.sim?.livery === sim.livery) p.aircraft_id = aircraftId;
    }
    this.note(`Bound ${sim.title}${sim.livery ? ` (${sim.livery})` : ""} to fleet aircraft #${aircraftId}`);
    this.save(true);
    this.emitStatus();
  }

  /** Attach (or clear) the SimBrief plan for the flight being flown or about to be flown. */
  setBriefing(b: BriefingSummary | null): void {
    this.refuseAfterShutdown();
    const prev = this.s.briefing;
    this.s.briefing = b;
    if (prev && (!b || b.id !== prev.id)) briefingDropUnused.run(prev.id);
    this.note(b ? `SimBrief plan ${b.origin.icao ?? "?"} → ${b.dest.icao ?? "?"} attached to this flight` : "SimBrief plan removed");
    this.save(true);
    this.emitStatus();
  }

  discardLeg(reason: string): void {
    this.refuseAfterShutdown();
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
    this.refuseAfterShutdown();
    const st = this.s;
    if (!st.leg) throw new TrackerRefused("no leg is being flown");
    if (st.phase !== "landed" || !st.last) throw new TrackerRefused("the aircraft has not landed yet");
    this.complete(st.last);
  }

  /** Log that pending leg as a hop, filling in whatever the tracker could not work out. */
  // @spec LIVE-HOP-004, LIVE-API-014
  savePending(id: string, o: { aircraft_id?: number | null; origin?: string | null; dest?: string | null }): LoggedHop {
    this.refuseAfterShutdown();
    const p = this.s.pending.find((x) => x.id === id);
    if (!p) throw new TrackerRefused("there is no leg waiting to be logged with that id");
    const aircraftId = o.aircraft_id ?? p.aircraft_id;
    const origin = o.origin ?? p.origin;
    const dest = o.dest ?? p.dest;
    if (!aircraftId || !aircraftExists.get(aircraftId)) throw new TrackerRefused("choose a fleet aircraft for this leg");
    if (!origin) throw new TrackerRefused("the departure airport is required");
    if (!dest) throw new TrackerRefused("the arrival airport is required");
    const draft: HopDraft = {
      origin,
      dest,
      departed_at: p.departed_at,
      arrived_at: p.arrived_at,
      duration_min: p.duration_min,
      track: p.track,
      landings: p.landings,
      stats: p.stats,
      briefing_id: p.briefing_id,
    };
    const message = loggedMessage(origin, dest, p.duration_min, p.landings);
    const hop = this.logHop(aircraftId, draft, message, () => {
      this.s.pending = this.s.pending.filter((x) => x !== p);
    });
    this.emit("hop", { hop, message } satisfies HopEvent);
    this.emitStatus();
    return hop;
  }

  /** Drop that pending leg, and its SimBrief briefing unless a hop uses it. False for an unknown id. */
  // @spec LIVE-HOP-005
  discardPending(id: string): boolean {
    this.refuseAfterShutdown();
    const p = this.s.pending.find((x) => x.id === id);
    if (!p) return false;
    this.s.pending = this.s.pending.filter((x) => x !== p);
    this.note("Discarded the unlogged leg");
    this.save(true);
    if (p.briefing_id != null) briefingDropUnused.run(p.briefing_id);
    this.emitStatus();
    return true;
  }

  /**
   * Switch casual mode. On: a landed leg is closed as for any interruption; an airborne one is
   * dropped, its track starting the path — but a bound fleet aircraft's only when `dropLeg` says
   * so, otherwise CasualRefused. Off: the path goes and leg detection resumes from idle.
   * Asking for the state it is already in changes nothing.
   */
  // @spec LIVE-CASUAL-005, LIVE-CASUAL-006, LIVE-CASUAL-007, LIVE-CASUAL-008, LIVE-CASUAL-009, LIVE-CASUAL-012, LIVE-API-012
  setCasual(on: boolean, opts: { dropLeg?: boolean } = {}): void {
    this.refuseAfterShutdown();
    const st = this.s;
    if (on === (this.casual != null)) return;
    if (!on) {
      this.casual = null;
      this.note("Casual mode off: takeoffs and landings are logged again");
      this.emit("path", []);
      this.save(true);
      this.emitStatus();
      return;
    }

    let seed: TrackPoint[] = [];
    let dropped: string | null = null;
    if (st.leg && st.phase === "landed") {
      this.complete(st.last!);
    } else if (st.leg) {
      const bound = st.aircraft_id && aircraftExists.get(st.aircraft_id) ? st.aircraft_id : null;
      if (bound && !opts.dropLeg) {
        const a = aircraftName.get(bound) as { name: string; livery: string };
        throw new CasualRefused({
          aircraft_id: bound,
          name: a.livery ? `${a.name} · ${a.livery}` : a.name,
          origin: st.leg.origin,
          departed_at: iso(st.leg.departed_at),
        });
      }
      seed = st.leg.track.slice();
      dropped = st.leg.origin ?? "?";
      st.leg = null;
      this.emit("track", []);
    }
    st.phase = "idle";
    st.lastGround = null;
    st.lastAirborne = null;
    st.airborneSince = null;
    st.stopSince = null;
    this.casual = { since: Date.now(), path: seed.length ? [seed] : [], breakPending: false };
    this.note(`Casual mode on: nothing is logged${dropped ? `; dropped the leg from ${dropped}` : ""}`);
    this.emit("path", this.casual.path);
    this.save(true);
    this.emitStatus();
  }

  /** Empty the casual path, staying in casual mode. */
  // @spec LIVE-CASUAL-010
  clearPath(): void {
    if (this.casual) {
      this.casual.path = [];
      this.casual.breakPending = false;
      this.emit("path", this.casual.path);
    }
    this.emitStatus();
  }

  // ------------------------------------------------------------------ samples

  feed(s: SimSample): void {
    if (this.stopped) return;
    const st = this.s;
    if (!this.simRunning || this.paused || !isRealPosition(s)) {
      this.emitStatus();
      return;
    }
    /** Checkpoint with this sample whatever the throttle says: a leg started, landed or measured, or the binding changed. */
    let force = false;

    // A leg restored in the air goes on only if this, the first sample taken, resumes it; otherwise
    // it is kept as pending and this sample starts tracking afresh, from idle.
    // @spec LIVE-LEG-016
    if (this.takeRestoredInAir() && !this.resumes(s)) {
      this.keepLeg(NOT_RESUMED);
      st.phase = "idle";
      st.lastGround = null;
      st.lastAirborne = null;
    }

    // Which aircraft is being flown? A change mid-leg means the user loaded a different plane.
    if (!st.sim || st.sim.title !== s.title || st.sim.livery !== s.livery) {
      if (st.sim && st.leg) {
        if (st.phase === "landed") this.complete(st.last ?? s);
        else this.discardLeg(`the aircraft changed to ${s.title}`);
      }
      st.sim = { title: s.title, livery: s.livery, atc_id: s.atc_id };
      const bound = this.lookupBinding(s.title, s.livery);
      if (bound !== st.aircraft_id) force = true;
      st.aircraft_id = bound;
      // In casual mode an unbound aircraft is not worth a word: nothing is being logged to it.
      this.note(
        st.aircraft_id || this.casual
          ? `Flying ${s.title}${s.livery ? ` (${s.livery})` : ""}`
          : `${s.title}${s.livery ? ` (${s.livery})` : ""} is not bound to a fleet aircraft`,
      );
    } else if (st.sim.atc_id !== s.atc_id) {
      st.sim.atc_id = s.atc_id;
    }

    // Slew, teleport, or a new flight loaded somewhere else. A landed leg closes at the last sample
    // before the jump, without the jumping one, and with the measured touchdown the jumping sample
    // carries, placed where the aircraft last was; an airborne leg is discarded.
    // @spec LIVE-LEG-010, LIVE-LEG-011, LIVE-LAND-002
    if (st.last) {
      const d = distanceNm(st.last.lat, st.last.lon, s.lat, s.lon);
      if (d > jumpBoundNm(s.t - st.last.t)) {
        if (this.casual) this.casual.breakPending = true;
        if (st.leg && st.phase === "landed") {
          if (s.touchdown) this.applyTouchdown(st.leg, s.touchdown, st.last);
          this.complete(st.last);
        } else if (st.leg) {
          this.discardLeg(`the position jumped ${Math.round(d)} nm`);
        }
        st.phase = "idle";
        st.lastGround = null;
        st.lastAirborne = null;
        st.airborneSince = null;
        st.stopSince = null;
      }
    }

    // Casual mode: no legs, only the path.
    if (this.casual) {
      this.recordCasual(this.casual, s);
      st.last = s;
      this.save(force);
      this.emitStatus();
      return;
    }

    if (s.touchdown && st.leg) {
      this.applyTouchdown(st.leg, s.touchdown, s);
      force = true;
    }

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
          force = true;
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
            force = true;
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
          force = true;
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
    this.save(force);
    this.emitStatus();
  }

  // ------------------------------------------------------------------ internals

  private lookupBinding(title: string, livery: string): number | null {
    const row = bindLookup.get(title, livery, livery) as { id: number } | undefined;
    return row?.id ?? null;
  }

  /** The bound fleet aircraft, while it still exists. */
  private boundAircraft(): number | null {
    const id = this.s.aircraft_id;
    return id && aircraftExists.get(id) ? id : null;
  }

  /**
   * Whether a leg restored in the air is still the one in progress, waiting for the sim. Asked once:
   * the first sample or flight load after the restore settles it either way.
   */
  private takeRestoredInAir(): boolean {
    const restored = this.restoredInAir;
    this.restoredInAir = null;
    return restored != null && restored === this.s.leg && this.s.phase === "airborne";
  }

  /** Whether sample `s` shows the restored leg's flight going on: the same aircraft, in the air, within reach. */
  private resumes(s: SimSample): boolean {
    const { sim, last } = this.s;
    if (!sim || sim.title !== s.title || sim.livery !== s.livery || s.on_ground || !last) return false;
    return distanceNm(last.lat, last.lon, s.lat, s.lon) <= jumpBoundNm(s.t - last.t);
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

  /**
   * Add a sample to the casual path: a new segment when the path is empty or after a break, else
   * the last segment at most every SAMPLE_MS; nothing while standing still on the ground.
   */
  // @spec LIVE-CASUAL-001, LIVE-CASUAL-002, LIVE-CASUAL-003, LIVE-CASUAL-004, LIVE-API-011
  private recordCasual(c: Casual, s: SimSample) {
    if (s.on_ground && fin(s.gs_kts) < STILL_KTS) return;
    const seg = c.path[c.path.length - 1];
    if (!seg || c.breakPending) {
      c.path.push([point(s)]);
      c.breakPending = false;
      this.emit("path", c.path);
      return;
    }
    if (s.t - seg[seg.length - 1][3] * 1000 < SAMPLE_MS) return;
    const p = point(s);
    seg.push(p);
    this.emit("path-point", p);
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

  /** Close the current leg at sample `s` (where the aircraft stopped) and log it, or keep it as pending. */
  private complete(s: SimSample) {
    const st = this.s;
    const leg = st.leg;
    if (!leg) return;
    const touchdown = leg.touchdown_at ?? s.t;
    const track = withPoint(leg.track, s);
    const close = () => {
      st.leg = null;
      st.phase = "ground";
      st.lastGround = s;
      st.airborneSince = null;
      st.stopSince = null;
    };

    const durationMin = Math.round((touchdown - leg.departed_at) / 60000);
    if (durationMin < MIN_LEG_MIN) {
      close();
      this.emit("track", []);
      this.note("Dropped a leg under a minute long");
      this.save(true);
      return;
    }

    const dest = nearestAirport(s.lat, s.lon, NEAR_NM)?.ident ?? null;
    const aircraftId = this.boundAircraft();
    const draft = {
      origin: leg.origin,
      dest,
      departed_at: iso(leg.departed_at),
      arrived_at: iso(touchdown),
      duration_min: durationMin,
      track,
      landings: leg.landings,
      stats: legStats(leg, track, s),
      briefing_id: st.briefing?.id ?? null,
    };
    const reason = !aircraftId
      ? "no fleet aircraft is bound to this sim aircraft"
      : !leg.origin
        ? "the departure airport is unknown"
        : !dest
          ? `no airport within ${NEAR_NM} nm of where it stopped`
          : null;

    if (!reason) {
      // @spec LIVE-HOP-006, LIVE-API-014
      const message = loggedMessage(draft.origin!, dest!, durationMin, leg.landings);
      const hop = this.logHop(aircraftId!, draft as HopDraft, message, () => {
        close();
        st.briefing = null;
      });
      this.emit("track", []);
      this.emit("hop", { hop, message } satisfies HopEvent);
    } else {
      close();
      st.briefing = null;
      this.emit("track", []);
      this.keepPending(
        { sim: { ...(st.sim ?? { title: s.title, livery: s.livery, atc_id: s.atc_id }) }, aircraft_id: aircraftId, ...draft, reason, ended_in_air: false },
        `Leg ${draft.origin ?? "?"} → ${dest ?? "?"} (${fmtMin(durationMin)}) needs details: ${reason}`,
      );
    }
  }

  /**
   * Keep the leg in the air as a pending leg ending at the last sample, with no destination and the
   * current briefing: after a disconnect in flight, or for a restored leg the sim did not resume.
   */
  private keepLeg(reason: string) {
    const st = this.s;
    const leg = st.leg;
    if (!leg) return;
    const end = st.last;
    const arrived = end?.t ?? leg.departed_at;
    const track = end ? withPoint(leg.track, end) : leg.track;
    const durationMin = Math.round((arrived - leg.departed_at) / 60000);
    const kept: Omit<PendingLeg, "id"> = {
      sim: { ...(st.sim ?? { title: "", livery: "", atc_id: "" }) },
      aircraft_id: this.boundAircraft(),
      origin: leg.origin,
      dest: null,
      departed_at: iso(leg.departed_at),
      arrived_at: iso(arrived),
      duration_min: durationMin,
      track,
      landings: leg.landings,
      stats: legStats(leg, track, end),
      briefing_id: st.briefing?.id ?? null,
      reason,
      ended_in_air: true,
    };
    st.leg = null;
    st.briefing = null;
    st.phase = end?.on_ground ? "ground" : "idle";
    st.lastGround = end?.on_ground ? end : null;
    st.airborneSince = null;
    st.stopSince = null;
    this.emit("track", []);
    this.keepPending(kept, `Leg ${leg.origin ?? "?"} → ? (${fmtMin(durationMin)}) needs details: ${reason}`);
  }

  /** Add a leg to the pending list under an id of its own, checkpoint it and send it on. */
  // @spec LIVE-HOP-003, LIVE-API-014
  private keepPending(leg: Omit<PendingLeg, "id">, message: string) {
    const kept: PendingLeg = { id: randomUUID(), ...leg };
    this.s.pending.push(kept);
    this.note(message);
    this.save(true);
    this.emit("pending", listed(kept));
  }

  /**
   * Log a hop in one transaction with its briefing's link and the checkpoint that `change` leaves
   * behind. If any of those writes fails, nothing is written, the state goes back to what it was
   * and the error propagates: the flight stays in the checkpoint.
   */
  // @spec LIVE-SAVE-006
  private logHop(aircraftId: number, draft: HopDraft, message: string, change: () => void): LoggedHop {
    const before = { ...this.s };
    const lastSave = this.lastSave;
    change();
    this.s.message = message;
    this.s.message_at = new Date().toISOString();
    try {
      const hop = transaction(() => {
        const h = insertHop(aircraftId, draft);
        this.write();
        return h;
      });
      console.log(`[tracker] ${message}`);
      return hop;
    } catch (e) {
      Object.assign(this.s, before);
      this.lastSave = lastSave;
      throw e;
    }
  }

  private note(message: string) {
    this.s.message = message;
    this.s.message_at = new Date().toISOString();
    console.log(`[tracker] ${message}`);
  }

  /** Checkpoint the state: at once when `force`, otherwise at most every SAVE_MS. */
  // @spec LIVE-SAVE-001
  private save(force: boolean) {
    if (!force && Date.now() - this.lastSave < SAVE_MS) return;
    this.write();
  }

  /** Write the whole state to the checkpoint, with casual mode's switch and time but never its path. */
  private write() {
    const cp: Persisted = { ...this.s, casual: this.casual ? { since: this.casual.since } : null };
    saveStmt.run(JSON.stringify(cp), new Date().toISOString());
    this.lastSave = Date.now();
  }

  private emitStatus() {
    this.emit("status", this.status());
  }
}

/**
 * The server's tracker, restored from the checkpoint as it is loaded: casual mode off on a fresh
 * run, and the sim mode the server was started in (startTracking sets it again, with the sim host).
 */
// @spec LIVE-API-013, LIVE-CASUAL-015
export const tracker = new Tracker({ freshRun: currentInputs().freshRun });
tracker.setSimMode(currentInputs().sim);
