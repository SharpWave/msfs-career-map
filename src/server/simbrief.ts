import { db } from "./db.ts";

/** SimBrief publishes its aircraft profile list for integrations. */
const SIMBRIEF_INPUTS_URL = "https://www.simbrief.com/api/inputs.list.json";
const USER_AGENT = "MSFSCareerMap/0.6 (personal flight-sim logbook; local use)";
const CACHE_KEY = "simbrief_aircraft";
const TTL_MS = 24 * 3600 * 1000;

export interface SimbriefType {
  /** ICAO type designator, e.g. "A319" */
  id: string;
  /** SimBrief's display name, e.g. "A319-100" */
  name: string;
}

export interface SimbriefTypeList {
  types: SimbriefType[];
  source: "simbrief" | "cache" | "fallback";
  fetched_at: string | null;
}

/** Used only when SimBrief has never been reachable from this machine. */
const FALLBACK: SimbriefType[] = [
  ["C152", "Cessna 152"], ["C172", "Cessna 172"], ["C182", "Cessna 182"], ["C208", "Cessna 208 Caravan"],
  ["P28A", "Piper Cherokee/Archer"], ["PA24", "Piper Comanche"], ["PA32", "Piper Saratoga"], ["PA34", "Piper Seneca"],
  ["PA46", "Piper Malibu"], ["P46T", "Piper Meridian"], ["AEST", "Aerostar 600"], ["BE36", "Bonanza A36"],
  ["BE58", "Baron 58"], ["BE9L", "King Air 90"], ["B350", "King Air 350"], ["DA40", "Diamond DA40"],
  ["DA42", "Diamond DA42"], ["DA62", "Diamond DA62"], ["SR22", "Cirrus SR22"], ["SF50", "Cirrus Vision Jet"],
  ["TBM8", "TBM 850"], ["TBM9", "TBM 900"], ["PC12", "Pilatus PC-12"], ["DHC6", "Twin Otter"],
  ["C25C", "Citation CJ4"], ["C700", "Citation Longitude"], ["A319", "A319-100"], ["A320", "A320-200"],
  ["A20N", "A320neo"], ["B738", "737-800"], ["B38M", "737 MAX 8"], ["B748", "747-8"], ["B78X", "787-10"],
  ["AT76", "ATR 72-600"], ["DH8D", "Dash 8 Q400"],
].map(([id, name]) => ({ id, name }));

const kvGet = db.prepare(`SELECT value, fetched_at FROM kv_cache WHERE key = ?`);
const kvPut = db.prepare(`INSERT OR REPLACE INTO kv_cache (key, value, fetched_at) VALUES (?,?,?)`);

async function fetchFromSimbrief(): Promise<SimbriefType[]> {
  const res = await fetch(SIMBRIEF_INPUTS_URL, {
    headers: { "user-agent": USER_AGENT, accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`simbrief: ${res.status}`);
  const j = (await res.json()) as { aircraft?: Record<string, { id?: string; name?: string }> };
  const types: SimbriefType[] = [];
  for (const [key, v] of Object.entries(j.aircraft ?? {})) {
    const id = (v.id ?? key).toUpperCase();
    if (/^[A-Z0-9]{2,6}$/.test(id)) types.push({ id, name: v.name ?? id });
  }
  if (types.length < 20) throw new Error("simbrief: unexpectedly short aircraft list");
  types.sort((a, b) => a.id.localeCompare(b.id));
  return types;
}

/** SimBrief's aircraft list, refreshed daily; falls back to the last cached copy, then a built-in list. */
export async function simbriefAircraftTypes(): Promise<SimbriefTypeList> {
  const cached = kvGet.get(CACHE_KEY) as { value: string; fetched_at: string } | undefined;
  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < TTL_MS) {
    return { types: JSON.parse(cached.value), source: "cache", fetched_at: cached.fetched_at };
  }
  try {
    const types = await fetchFromSimbrief();
    const at = new Date().toISOString();
    kvPut.run(CACHE_KEY, JSON.stringify(types), at);
    return { types, source: "simbrief", fetched_at: at };
  } catch (e) {
    console.warn(`[simbrief] aircraft list unavailable: ${e instanceof Error ? e.message : e}`);
    if (cached) return { types: JSON.parse(cached.value), source: "cache", fetched_at: cached.fetched_at };
    return { types: FALLBACK, source: "fallback", fetched_at: null };
  }
}
