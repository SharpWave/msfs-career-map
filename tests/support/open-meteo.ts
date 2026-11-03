import { answerFetch } from "./fetch-guard.ts";

/** One node's wind at one pressure level, as Open-Meteo gives it: knots, and the direction it blows from. */
export interface NodeWind {
  speed: number | null;
  direction: number | null;
}

export type WindAt = (lat: number, lon: number, hpa: number) => NodeWind;

/** Every Open-Meteo forecast request answered, in the order they arrived. */
export interface ForecastLog {
  urls: URL[];
  userAgents: (string | null)[];
}

export const FORECAST = /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/;

/**
 * Open-Meteo's answer to a forecast request, shaped as it answers: a list of locations, or one
 * location on its own for a single coordinate. Each location comes back at a position snapped a
 * little off the one asked for, as the real API snaps to its model grid, so the answer can only be
 * matched to the request by order.
 */
export function forecastResponse(url: URL, wind: WindAt): Response {
  const lats = (url.searchParams.get("latitude") ?? "").split(",").map(Number);
  const lons = (url.searchParams.get("longitude") ?? "").split(",").map(Number);
  const vars = (url.searchParams.get("hourly") ?? "").split(",");
  const hour = url.searchParams.get("start_hour");
  const locations = lats.map((lat, i) => {
    const hourly: Record<string, unknown> = { time: [hour] };
    for (const v of vars) {
      const m = /^wind_(speed|direction)_(\d+)hPa$/.exec(v);
      if (!m) continue;
      const w = wind(lat, lons[i], Number(m[2]));
      hourly[v] = [m[1] === "speed" ? w.speed : w.direction];
    }
    return { latitude: lat + 0.013, longitude: lons[i] - 0.017, hourly };
  });
  return Response.json(locations.length === 1 ? locations[0] : locations);
}

/** Answer Open-Meteo's forecast API with `wind`, logging each request. */
export function answerForecast(wind: WindAt, log: ForecastLog = { urls: [], userAgents: [] }): ForecastLog {
  answerFetch(FORECAST, (url, init) => {
    log.urls.push(url);
    log.userAgents.push(new Headers(init?.headers).get("user-agent"));
    return forecastResponse(url, wind);
  });
  return log;
}

/** The number of locations each logged request asked for. */
export const locationsAsked = (log: ForecastLog) => log.urls.map((u) => (u.searchParams.get("latitude") ?? "").split(",").length);

/** The total number of locations the logged requests asked for. */
export const totalAsked = (log: ForecastLog) => locationsAsked(log).reduce((a, b) => a + b, 0);

/** The same wind everywhere and at every level. */
export const steady = (speed: number, direction: number): WindAt => () => ({ speed, direction });
