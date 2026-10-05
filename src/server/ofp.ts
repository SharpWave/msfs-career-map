/**
 * SimBrief: fetch a pilot's latest OFP and boil it down to what the app stores and shows.
 *
 * The fetcher is keyed by the pilot's Navigraph alias (username) or numeric pilot ID and needs no
 * token. `json=v2` returns proper numbers and arrays; the parser below still tolerates the older
 * all-strings shape, because SimBrief has changed this before.
 */

export interface OfpFix {
  ident: string;
  name: string;
  /** "apt", "wpt", "vor", "ndb", "ltlg", ... as SimBrief labels them. */
  type: string;
  lat: number;
  lon: number;
  alt_ft: number | null;
  /** Airway into this fix, or "DCT". */
  airway: string | null;
  is_sid_star: boolean;
}

/** The compact form kept on the tracker status and in the briefing list. */
export interface BriefingSummary {
  id: number;
  ofp_id: string | null;
  static_id: string | null;
  generated_at: string | null;
  airline: string | null;
  flight_number: string | null;
  callsign: string | null;
  aircraft: { icao: string | null; name: string | null; reg: string | null };
  origin: { icao: string | null; name: string | null; rwy: string | null };
  dest: { icao: string | null; name: string | null; rwy: string | null };
  alternate: { icao: string | null; name: string | null } | null;
  route: string | null;
  distance_nm: number | null;
  cruise_alt_ft: number | null;
  ete_min: number | null;
  fuel: { units: string; ramp: number | null; takeoff: number | null; landing: number | null; burn: number | null };
  weights: { pax: number | null; cargo: number | null; payload: number | null; zfw: number | null; tow: number | null; ldw: number | null };
  pdf_url: string | null;
  fixes: OfpFix[];
}

export interface FetchedOfp {
  summary: Omit<BriefingSummary, "id">;
  plan_html: string | null;
  raw: unknown;
}

type J = Record<string, unknown>;
const obj = (v: unknown): J => (v && typeof v === "object" && !Array.isArray(v) ? (v as J) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : v && typeof v === "object" ? [v] : []);
const str = (v: unknown): string | null => {
  if (v == null || typeof v === "object") return null;
  const s = String(v).trim();
  return s ? s : null;
};
const num = (v: unknown): number | null => {
  if (v == null || v === "" || typeof v === "object") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function fetcherUrl(user: string): string {
  const key = /^\d+$/.test(user.trim()) ? "userid" : "username";
  return `https://www.simbrief.com/api/xml.fetcher.php?${key}=${encodeURIComponent(user.trim())}&json=v2`;
}

/** Latest OFP for a SimBrief alias or pilot ID. Throws with SimBrief's own message on failure. */
export async function fetchLatestOfp(user: string): Promise<FetchedOfp> {
  const res = await fetch(fetcherUrl(user), { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20000) });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }
  const status = str(obj(obj(data).fetch).status);
  if (!res.ok || !data || (status && !/success/i.test(status))) {
    throw new Error(status ?? `SimBrief returned ${res.status}`);
  }
  return parseOfp(data);
}

export function parseOfp(raw: unknown): FetchedOfp {
  const o = obj(raw);
  const params = obj(o.params);
  const general = obj(o.general);
  const origin = obj(o.origin);
  const dest = obj(o.destination);
  const alternate = obj(arr(o.alternate)[0]);
  const aircraft = obj(o.aircraft);
  const fuel = obj(o.fuel);
  const weights = obj(o.weights);
  const times = obj(o.times);
  const atc = obj(o.atc);
  const files = obj(o.files);
  const text = obj(o.text);

  const generated = num(params.time_generated);
  const dir = str(files.directory);
  const pdfLink = str(obj(files.pdf).link);
  const fixes: OfpFix[] = [];
  for (const f0 of arr(obj(o.navlog).fix)) {
    const f = obj(f0);
    const lat = num(f.pos_lat);
    const lon = num(f.pos_long);
    if (lat === null || lon === null) continue;
    fixes.push({
      ident: str(f.ident) ?? "",
      name: str(f.name) ?? "",
      type: str(f.type) ?? "",
      lat,
      lon,
      alt_ft: num(f.altitude_feet),
      airway: str(f.via_airway),
      is_sid_star: str(f.is_sid_star) === "1",
    });
  }
  const ete = num(times.est_time_enroute);

  return {
    summary: {
      ofp_id: str(params.request_id),
      static_id: str(params.static_id),
      generated_at: generated !== null ? new Date(generated * 1000).toISOString() : null,
      airline: str(general.icao_airline),
      flight_number: str(general.flight_number),
      callsign: str(atc.callsign),
      aircraft: { icao: str(aircraft.icaocode) ?? str(aircraft.icao_code), name: str(aircraft.name), reg: str(aircraft.reg) },
      origin: { icao: str(origin.icao_code), name: str(origin.name), rwy: str(origin.plan_rwy) },
      dest: { icao: str(dest.icao_code), name: str(dest.name), rwy: str(dest.plan_rwy) },
      alternate: str(alternate.icao_code) ? { icao: str(alternate.icao_code), name: str(alternate.name) } : null,
      route: str(general.route),
      distance_nm: num(general.route_distance) ?? num(general.gc_distance),
      cruise_alt_ft: num(general.initial_altitude),
      ete_min: ete !== null ? Math.round(ete / 60) : null,
      fuel: {
        units: str(params.units) ?? "lbs",
        ramp: num(fuel.plan_ramp),
        takeoff: num(fuel.plan_takeoff),
        landing: num(fuel.plan_landing),
        burn: num(fuel.enroute_burn),
      },
      weights: {
        pax: num(weights.pax_count),
        cargo: num(weights.cargo),
        payload: num(weights.payload),
        zfw: num(weights.est_zfw),
        tow: num(weights.est_tow),
        ldw: num(weights.est_ldw),
      },
      pdf_url: dir && pdfLink ? dir + pdfLink : null,
      fixes,
    },
    plan_html: str(text.plan_html),
    raw,
  };
}
