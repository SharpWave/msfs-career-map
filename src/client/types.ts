export type SurfaceClass = "paved" | "grass" | "gravel" | "dirt" | "water" | "snow" | "unknown";

export interface Runway {
  le_ident: string | null;
  he_ident: string | null;
  length_ft: number | null;
  width_ft: number | null;
  surface: string | null;
  surface_class: SurfaceClass;
  lighted: number;
  closed: number;
}

export interface Airport {
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
  /** Longest open runway in feet, null when OurAirports has no runway data. */
  rwy_max_ft: number | null;
  rwy_count: number;
  /** Comma-separated surface classes, e.g. "paved,grass". */
  rwy_surfaces: string | null;
  rwy_paved: number;
  rwy_lighted: number;
  /** Present on single-airport lookups, map state and planner results. */
  runways?: Runway[];
}

export interface Aircraft {
  id: number;
  name: string;
  livery: string;
  color: string;
  /** "builtin:<key>", "/images/<file>", or an http(s) URL */
  icon: string;
  notes: string;
  visible: number;
  cruise_kts: number | null;
  min_runway_ft: number | null;
  created_at: string;
}

export interface Hop {
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

export interface AppState {
  aircraft: Aircraft[];
  hops: Hop[];
  airports: Record<string, Airport>;
  airportCount: number;
  runwayCount: number;
}

export interface AircraftInput {
  name: string;
  livery: string;
  color: string;
  icon: string;
  notes: string;
  cruise_kts: number | null;
  min_runway_ft: number | null;
  visible?: boolean;
}

export interface HopInput {
  aircraft_id: number;
  origin: string;
  dest: string;
  departed_at: string | null;
  arrived_at: string | null;
  duration_min: number | null;
  notes: string;
}

export interface PlanQuery {
  aircraft_id: number;
  max_minutes: number;
  types: string[];
  paved: boolean;
  /** Override the starting airport (defaults to where the aircraft is parked). */
  from?: string;
}

export interface PlanCandidate extends Airport {
  runways: Runway[];
  distance_nm: number;
  bearing_deg: number;
  est_minutes: number;
}

export interface PlanResult {
  aircraft_id: number;
  cruise_kts: number;
  max_minutes: number;
  range_nm: number;
  min_runway_ft: number | null;
  paved_only: boolean;
  types: string[];
  origin: Airport;
  total: number;
  truncated: boolean;
  candidates: PlanCandidate[];
}
