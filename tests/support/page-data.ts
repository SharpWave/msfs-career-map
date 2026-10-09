/**
 * Builders for the data the page receives from `/api` — aircraft, hops, airports, map state, tracker
 * status — so component tests can state only what matters to them.
 */
import type { Aircraft, Airport, AppState, Hop, PendingLeg, PlanCandidate, PlanResult, TrackerStatus } from "../../src/client/types.ts";
import type { LiveState } from "../../src/client/tracker.ts";

export function aircraft(over: Partial<Aircraft> = {}): Aircraft {
  return {
    id: 1,
    name: "Piper Comanche 250",
    livery: "N6229P",
    color: "#ff6b35",
    icon: "builtin:single-piston",
    notes: "",
    visible: 1,
    cruise_kts: 160,
    min_runway_ft: null,
    simbrief_type: null,
    ceiling_ft: 12000,
    oxygen: 0,
    max_xwind_kts: null,
    ifr_capable: 1,
    cruise_alt_ft: null,
    climb_fpm: null,
    climb_kts: null,
    descent_fpm: null,
    overhead_min: null,
    sim_title: null,
    sim_livery: null,
    created_at: "2026-10-01T12:00:00.000Z",
    ...over,
  };
}

export function hop(over: Partial<Hop> = {}): Hop {
  return {
    id: 1,
    aircraft_id: 1,
    seq: 1,
    origin: "KBOS",
    dest: "KPVD",
    departed_at: null,
    arrived_at: null,
    duration_min: null,
    notes: "",
    track: null,
    landings: null,
    stats: null,
    briefing_id: null,
    created_at: "2026-10-01T12:00:00.000Z",
    ...over,
  };
}

const AIRPORT_POS: Record<string, [string, number, number]> = {
  KBOS: ["Boston Logan International Airport", 42.3643, -71.0052],
  KPVD: ["Rhode Island T. F. Green International Airport", 41.7246, -71.4282],
  KHYA: ["Cape Cod Gateway Airport", 41.6693, -70.2804],
  KACK: ["Nantucket Memorial Airport", 41.2531, -70.0602],
};

export function airport(ident: string, over: Partial<Airport> = {}): Airport {
  const [name, lat, lon] = AIRPORT_POS[ident] ?? [`${ident} Airport`, 41.5, -71];
  return {
    ident,
    type: "medium_airport",
    name,
    lat,
    lon,
    elevation_ft: 20,
    iso_country: "US",
    iso_region: "US-MA",
    municipality: null,
    icao_code: ident,
    iata_code: null,
    gps_code: ident,
    local_code: null,
    wikipedia_link: null,
    home_link: null,
    rwy_max_ft: 6000,
    rwy_count: 2,
    rwy_surfaces: "paved",
    rwy_paved: 1,
    rwy_lighted: 1,
    rwy_headings: "50,140",
    ...over,
  };
}

export function appState(over: Partial<AppState> = {}): AppState {
  const hops = over.hops ?? [];
  const idents = new Set(hops.flatMap((h) => [h.origin, h.dest]));
  return {
    aircraft: [],
    hops,
    airports: Object.fromEntries([...idents].map((i) => [i, airport(i)])),
    airportCount: 72609,
    runwayCount: 48291,
    ...over,
  };
}

export function trackerStatus(over: Partial<TrackerStatus> = {}): TrackerStatus {
  return {
    connected: true,
    sim_name: "MSFS 2024",
    sim_running: true,
    paused: false,
    livery_supported: true,
    sim: { title: "Comanche 250", livery: "Blue Stripe", atc_id: "N6229P" },
    aircraft_id: null,
    phase: "ground",
    position: null,
    leg: null,
    pending: null,
    briefing: null,
    message: null,
    message_at: null,
    ...over,
  };
}

export function pendingLeg(over: Partial<PendingLeg> = {}): PendingLeg {
  return {
    sim: { title: "Comanche 250", livery: "Blue Stripe", atc_id: "N6229P" },
    aircraft_id: null,
    origin: "KBOS",
    dest: null,
    departed_at: "2026-10-09T14:00:00.000Z",
    arrived_at: "2026-10-09T14:40:00.000Z",
    duration_min: 40,
    points: 480,
    landings: [],
    stats: {
      fuel_start_lb: null, fuel_end_lb: null, fuel_used_lb: null, weight_start_lb: null,
      weight_end_lb: null, max_alt_ft: null, max_gs_kts: null, flown_nm: null,
    },
    briefing_id: null,
    reason: "The landing airport could not be named.",
    ...over,
  };
}

export function liveState(status: TrackerStatus | null = null, over: Partial<LiveState> = {}): LiveState {
  return { status, track: [], online: true, ...over };
}

export function planResult(aircraftId: number, candidates: string[]): PlanResult {
  const origin = airport("KPVD");
  return {
    aircraft_id: aircraftId,
    cruise_kts: 160,
    max_minutes: 90,
    range_nm: 200,
    naive_range_nm: 240,
    profile: { cruise_kts: 160, cruise_alt_ft: 6500, climb_fpm: 700, climb_kts: 90, descent_fpm: 500, overhead_min: 12 },
    min_runway_ft: null,
    paved_only: false,
    types: ["large_airport", "medium_airport", "small_airport"],
    max_elevation_ft: null,
    elevation_reason: null,
    origin,
    total: candidates.length,
    truncated: false,
    shown_nm: 200,
    candidates: candidates.map(
      (c): PlanCandidate => ({ ...airport(c), distance_nm: 60, bearing_deg: 120, est_minutes: 35 }),
    ),
  };
}
