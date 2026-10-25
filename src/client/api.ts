import type {
  Aircraft,
  AircraftInput,
  Airport,
  AppState,
  HazardSet,
  Hop,
  HopInput,
  Metar,
  PendingLegDetail,
  PlanQuery,
  PlanResult,
  Briefing,
  BriefingSummary,
  Settings,
  TerrainResult,
  TrackerStatus,
  WikiSummary,
} from "./types";
import type { AirportDataReport } from "./notices";

/** A failed API call: the server's message, with the HTTP status and the answer's body (null when not JSON). */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Set once the page is about to reload itself: from then on it sends the server no change. */
let frozen = false;

// @spec APP-API-006, APP-API-007
async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  if (frozen && method !== "GET") throw new ApiError("The page is reloading", 0, null);
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    throw new ApiError((data as { error?: string } | undefined)?.error ?? `${res.status} ${res.statusText}`, res.status, data ?? null);
  }
  return (data ?? {}) as T;
}

/** The server as `/api/status` describes it (app-shell, APP-API-004). */
export interface ServerStatus {
  version: string;
  pid: number;
  logbookId: string | null;
  startup: string;
  airportData: AirportDataReport;
  ready: boolean;
}

export type OfferedLogbook =
  | { kind: "folder"; folder: string; hops: number; newestHop: string | null }
  | { kind: "backup"; file: string; time: string; hops: number; newestHop: string | null };

export interface LogbookOffer {
  hops: number;
  aircraft: number;
  offers: OfferedLogbook[];
  lastAttempt: { outcome: "brought-in" | "not-brought-in"; reason?: string; at: string } | null;
}

export const api = {
  /** From now on every call that would change something is refused without being sent (APP-UI-036, APP-UI-042). */
  freezeChanges: () => {
    frozen = true;
  },

  state: () => req<AppState>("GET", "/api/state"),
  status: () => req<ServerStatus>("GET", "/api/status"),
  backup: () => req<{ file: string }>("POST", "/api/backups"),
  logbookOffer: () => req<LogbookOffer>("GET", "/api/logbook/offer"),
  bringIn: (body: { folder: string } | { backup: string }) => req<{ restart: "automatic" | "manual" }>("POST", "/api/logbook/import", body),

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

  tracker: () => req<TrackerStatus>("GET", "/api/tracker"),
  trackerBind: (aircraftId: number) => req<TrackerStatus>("POST", "/api/tracker/bind", { aircraft_id: aircraftId }),
  trackerPending: (id: string) => req<PendingLegDetail>("GET", `/api/tracker/pending/${encodeURIComponent(id)}`),
  trackerSavePending: (id: string, o: { aircraft_id?: number | null; origin?: string | null; dest?: string | null }) =>
    req<Hop>("POST", `/api/tracker/pending/${encodeURIComponent(id)}`, o),
  trackerDiscardPending: (id: string) => req<TrackerStatus>("DELETE", `/api/tracker/pending/${encodeURIComponent(id)}`),
  trackerDiscardLeg: () => req<TrackerStatus>("DELETE", "/api/tracker/leg"),
  trackerCompleteLeg: () => req<TrackerStatus>("POST", "/api/tracker/complete"),
  /** Refused with a 409 ApiError naming the leg while a fleet aircraft's leg is airborne, unless `dropLeg`. */
  trackerCasual: (on: boolean, dropLeg = false) =>
    req<TrackerStatus>("PUT", "/api/tracker/casual", dropLeg ? { on, drop_leg: true } : { on }),
  trackerClearPath: () => req<TrackerStatus>("DELETE", "/api/tracker/path"),
  trackerBriefing: () => req<TrackerStatus>("POST", "/api/tracker/briefing"),
  trackerDropBriefing: () => req<TrackerStatus>("DELETE", "/api/tracker/briefing"),

  settings: () => req<Settings>("GET", "/api/settings"),
  saveSettings: (s: Partial<Settings>) => req<Settings>("PUT", "/api/settings", s),
  simbriefLatest: (username?: string) =>
    req<Omit<BriefingSummary, "id"> & { id: null; has_plan_html: boolean }>(
      "GET",
      `/api/simbrief/latest${username ? `?username=${encodeURIComponent(username)}` : ""}`,
    ),
  briefing: (id: number) => req<Briefing>("GET", `/api/briefings/${id}`),
  hopBriefing: (hopId: number) => req<Briefing>("GET", `/api/hops/${hopId}/briefing`),
  attachHopBriefing: (hopId: number) => req<Briefing>("POST", `/api/hops/${hopId}/briefing`),
  dropHopBriefing: (hopId: number) => req<void>("DELETE", `/api/hops/${hopId}/briefing`),

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
    if (q.cruise_alt_ft) p.set("cruise_alt_ft", String(q.cruise_alt_ft));
    return req<PlanResult>("GET", `/api/plan?${p.toString()}`);
  },
};
