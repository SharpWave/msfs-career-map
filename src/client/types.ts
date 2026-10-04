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
}

export interface AircraftInput {
  name: string;
  livery: string;
  color: string;
  icon: string;
  notes: string;
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
