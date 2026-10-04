import type {
  Aircraft,
  AircraftInput,
  Airport,
  AppState,
  HazardSet,
  Hop,
  HopInput,
  Metar,
  PlanQuery,
  PlanResult,
  TerrainResult,
  WikiSummary,
} from "./types";

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `${res.status} ${res.statusText}`);
  return data as T;
}

export const api = {
  state: () => req<AppState>("GET", "/api/state"),

  searchAirports: (q: string, limit = 10) =>
    req<Airport[]>("GET", `/api/airports/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  getAirport: (code: string) => req<Airport>("GET", `/api/airports/${encodeURIComponent(code)}`),
  wiki: (code: string) => req<WikiSummary>("GET", `/api/airports/${encodeURIComponent(code)}/wiki`),
  metar: (icao: string) => req<Metar>("GET", `/api/metar/${encodeURIComponent(icao)}`),
  metars: (ids: string[]) =>
    req<{ metars: Record<string, Metar | null>; fetched_at: string }>("GET", `/api/metars?ids=${encodeURIComponent(ids.join(","))}`),

  createAircraft: (a: AircraftInput) => req<Aircraft>("POST", "/api/aircraft", a),
  updateAircraft: (id: number, a: Partial<AircraftInput>) => req<Aircraft>("PUT", `/api/aircraft/${id}`, a),
  deleteAircraft: (id: number) => req<void>("DELETE", `/api/aircraft/${id}`),
  uploadIcon: (id: number, dataUrl: string) => req<Aircraft>("POST", `/api/aircraft/${id}/icon`, { dataUrl }),

  createHop: (h: HopInput) => req<Hop>("POST", "/api/hops", h),
  updateHop: (id: number, h: Partial<HopInput>) => req<Hop>("PUT", `/api/hops/${id}`, h),
  deleteHop: (id: number) => req<void>("DELETE", `/api/hops/${id}`),
  reorderHops: (aircraftId: number, ids: number[]) =>
    req<Hop[]>("PUT", `/api/aircraft/${aircraftId}/hops/order`, { ids }),

  hazards: () => req<HazardSet>("GET", "/api/hazards"),
  terrain: (from: [number, number], to: [number, number]) =>
    req<TerrainResult>("GET", `/api/terrain?from=${from[0]},${from[1]}&to=${to[0]},${to[1]}`),

  simbriefTypes: () =>
    req<{ types: { id: string; name: string }[]; source: string; fetched_at: string | null }>("GET", "/api/simbrief/aircraft"),

  plan: (q: PlanQuery) => {
    const p = new URLSearchParams({
      aircraft_id: String(q.aircraft_id),
      max_minutes: String(q.max_minutes),
      types: q.types.join(","),
      paved: q.paved ? "1" : "0",
    });
    if (q.from) p.set("from", q.from);
    return req<PlanResult>("GET", `/api/plan?${p.toString()}`);
  },
};
