export type SurfaceClass = "paved" | "grass" | "gravel" | "dirt" | "water" | "snow" | "unknown";

export interface Runway {
  le_ident: string | null;
  he_ident: string | null;
  le_heading: number | null;
  he_heading: number | null;
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
  wikipedia_link: string | null;
  home_link: string | null;
  /** Longest open runway in feet, null when OurAirports has no runway data. */
  rwy_max_ft: number | null;
  rwy_count: number;
  /** Comma-separated surface classes, e.g. "paved,grass". */
  rwy_surfaces: string | null;
  rwy_paved: number;
  rwy_lighted: number;
  /** Comma-separated true headings, one end of each open runway, e.g. "162,52". */
  rwy_headings: string | null;
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
  /** ICAO type designator SimBrief knows, e.g. "AEST", "TBM8", "C172". */
  simbrief_type: string | null;
  /** Service ceiling, feet. */
  ceiling_ft: number | null;
  /** 1 when pressurised or carrying oxygen. */
  oxygen: number;
  /** Maximum demonstrated crosswind, knots. */
  max_xwind_kts: number | null;
  /** 0 for VFR-only aircraft. */
  ifr_capable: number;
  /** Block-time model inputs; null means use the light-piston defaults. */
  cruise_alt_ft: number | null;
  climb_fpm: number | null;
  climb_kts: number | null;
  descent_fpm: number | null;
  overhead_min: number | null;
  created_at: string;
}

/** The performance numbers the planner actually used (defaults filled in). */
export interface PerfProfile {
  cruise_kts: number;
  cruise_alt_ft: number;
  climb_fpm: number;
  climb_kts: number;
  descent_fpm: number;
  overhead_min: number;
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
  simbrief_type: string | null;
  ceiling_ft: number | null;
  oxygen: boolean;
  max_xwind_kts: number | null;
  ifr_capable: boolean;
  cruise_alt_ft: number | null;
  climb_fpm: number | null;
  climb_kts: number | null;
  descent_fpm: number | null;
  overhead_min: number | null;
  visible?: boolean;
}

export type HazardKind = "ICE" | "TURB" | "IFR" | "MT_OBSC" | "CONVECTIVE" | "VA" | "TC";

export interface Hazard {
  id: string;
  source: "gairmet" | "sigmet" | "isigmet";
  kind: HazardKind;
  label: string;
  severity: string | null;
  base_ft: number | null;
  top_ft: number | null;
  valid_from: string | null;
  valid_to: string | null;
  forecast_hour: number | null;
  coords: [number, number][];
  fir: string | null;
  raw: string | null;
}

export interface HazardSet {
  hazards: Hazard[];
  fetched_at: string;
  errors: string[];
}

export interface TerrainResult {
  samples: { lat: number; lon: number; ft: number }[];
  max_ft: number;
  max_at: { lat: number; lon: number };
  clearance_ft: number;
  min_altitude_ft: number;
  oxygen_altitude_ft: number;
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

export interface WikiSummary {
  title: string | null;
  extract: string | null;
  thumbnail: string | null;
  image: string | null;
  url: string | null;
  fetched_at: string;
}

export interface Metar {
  icao: string;
  raw: string;
  flight_category: string | null;
  observed_at: string | null;
  temp_c: number | null;
  dewpoint_c: number | null;
  wind_dir: number | string | null;
  wind_kts: number | null;
  gust_kts: number | null;
  visibility: string | null;
  altimeter_hpa: number | null;
  clouds: { cover: string; base_ft: number | null }[];
  station: string | null;
}

export interface PlanQuery {
  aircraft_id: number;
  max_minutes: number;
  types: string[];
  paved: boolean;
  /** Override the starting airport (defaults to where the aircraft is parked). */
  from?: string;
  /** Override the aircraft's typical cruise altitude for this search. */
  cruise_alt_ft?: number;
}

/** A reachable airport. `runways` is absent here; the popup loads it on demand. */
export interface PlanCandidate extends Airport {
  distance_nm: number;
  bearing_deg: number;
  est_minutes: number;
}

export interface PlanResult {
  aircraft_id: number;
  cruise_kts: number;
  max_minutes: number;
  /** Ring radius from the block-time model (destination at the origin's elevation). */
  range_nm: number;
  /** What cruise speed × time alone would give. */
  naive_range_nm: number;
  profile: PerfProfile;
  min_runway_ft: number | null;
  paved_only: boolean;
  types: string[];
  /** Highest field elevation included, from the aircraft's ceiling / oxygen settings. */
  max_elevation_ft: number | null;
  elevation_reason: string | null;
  origin: Airport;
  total: number;
  truncated: boolean;
  /** Distance of the farthest returned candidate; less than range_nm when truncated. */
  shown_nm: number;
  candidates: PlanCandidate[];
}
