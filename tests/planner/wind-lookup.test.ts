/**
 * Looking winds up from Open-Meteo (PLAN-WIND-001, 007 to 011): the request, its hour and
 * User-Agent, requests of up to 100 nodes sent together, the 15 s limit, failures and the pause
 * after one, and the cache per forecast hour with its size limit.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { answerFetch, resetAnswers } from "../support/fetch-guard.ts";
import { FORECAST, answerForecast, forecastResponse, steady, totalAsked } from "../support/open-meteo.ts";
import { USER_AGENT } from "../../src/server/version.ts";
import { PRESSURE_LEVELS_HPA, chooseGrid, forgetWinds, lookupWinds, windCacheSize } from "../../src/server/winds.ts";

const ORH = { lat: 42.2673, lon: -71.8757 };
const LEVELS = [900, 850, 800, 700];
const at = (iso: string) => new Date(iso);
const look = (now: Date, origin = ORH, areaRadiusNm = 150, levels = LEVELS) => lookupWinds({ origin, areaRadiusNm, levels, now });

beforeEach(() => forgetWinds());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a wind lookup", () => {
  // @spec PLAN-WIND-001, PLAN-WIND-007
  it("asks Open-Meteo's forecast for the hour under way, in knots, at the levels given, with the server's User-Agent", async () => {
    const log = answerForecast(steady(25, 270));
    const r = await look(at("2026-11-02T14:59:59Z"));
    expect(r.status).toBe("forecast");
    if (r.status !== "forecast") return;
    expect(r.hour).toBe("2026-11-02T14:00Z");
    expect(r.spacingDeg).toBe(0.5);
    expect(r.levels).toEqual(LEVELS);
    expect(r.field.at(ORH.lat, ORH.lon, 5000).u).toBeCloseTo(25, 6);

    expect(log.urls.length).toBeGreaterThan(0);
    for (const url of log.urls) {
      expect(url.origin + url.pathname).toBe("https://api.open-meteo.com/v1/forecast");
      expect(url.searchParams.get("wind_speed_unit")).toBe("kn");
      expect(url.searchParams.get("start_hour")).toBe("2026-11-02T14:00");
      expect(url.searchParams.get("end_hour")).toBe("2026-11-02T14:00");
      expect(new Set(url.searchParams.get("hourly")!.split(","))).toEqual(
        new Set(LEVELS.flatMap((l) => [`wind_speed_${l}hPa`, `wind_direction_${l}hPa`])),
      );
    }
    expect(log.userAgents.every((ua) => ua === USER_AGENT)).toBe(true);
    expect(totalAsked(log)).toBe(chooseGrid(ORH, 150, LEVELS.length)!.nodes.length);
  });

  // @spec PLAN-WIND-007
  it("sends at most 100 nodes per request, all of them together", async () => {
    const grid = chooseGrid(ORH, 300, LEVELS.length)!;
    expect(grid.nodes.length).toBeGreaterThan(100);
    const asked: number[] = [];
    let open = 0, most = 0;
    answerFetch(FORECAST, async (url) => {
      asked.push((url.searchParams.get("latitude") ?? "").split(",").length);
      most = Math.max(most, ++open);
      await new Promise((r) => setTimeout(r, 30));
      open--;
      return forecastResponse(url, steady(10, 180));
    });
    expect((await look(at("2026-11-02T14:10:00Z"), ORH, 300)).status).toBe("forecast");
    expect(Math.max(...asked)).toBeLessThanOrEqual(100);
    expect(asked.reduce((a, b) => a + b, 0)).toBe(grid.nodes.length);
    expect(most).toBe(asked.length);
  });

  // @spec PLAN-WIND-007, PLAN-WIND-008
  it("gives up 15 s after the first request is sent", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    answerFetch(FORECAST, (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    );
    let done: unknown = null;
    const p = look(at("2026-11-02T14:10:00Z")).then((r) => (done = r));
    await vi.advanceTimersByTimeAsync(14_999);
    expect(done).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(done).toEqual({ status: "unavailable", reason: "failed" });
  });

  // @spec PLAN-WIND-008
  it("fails when a request fails", async () => {
    answerFetch(FORECAST, () => new Response("busy", { status: 503 }));
    expect(await look(at("2026-11-02T14:10:00Z"))).toEqual({ status: "unavailable", reason: "failed" });
  });

  // @spec PLAN-WIND-008, PLAN-WIND-006
  it("fails when a node comes back without a wind at any level", async () => {
    // The node at 42.5°N 72°W, inside the area, has no wind at any level.
    answerForecast((lat, lon) =>
      Math.abs(lat - 42.5) < 1e-9 && Math.abs(lon + 72) < 1e-9 ? { speed: null, direction: null } : { speed: 12, direction: 200 },
    );
    expect(await look(at("2026-11-02T14:10:00Z"))).toEqual({ status: "unavailable", reason: "failed" });
  });

  // @spec PLAN-WIND-009
  it("makes no lookup for 5 minutes after a failed one", async () => {
    answerFetch(FORECAST, () => new Response("busy", { status: 503 }));
    expect((await look(at("2026-11-02T14:10:00Z"))).status).toBe("unavailable");
    resetAnswers();
    const log = answerForecast(steady(10, 90));
    expect(await look(at("2026-11-02T14:14:59Z"))).toEqual({ status: "unavailable", reason: "recent_failure" });
    expect(log.urls).toHaveLength(0);
    expect((await look(at("2026-11-02T14:15:01Z"))).status).toBe("forecast");
    expect(log.urls.length).toBeGreaterThan(0);
  });
});

describe("Open-Meteo's rate limit", () => {
  const limited = () => Response.json({ reason: "Minutely API request limit exceeded. Please try again in one minute.", error: true }, { status: 429 });

  // @spec PLAN-WIND-014
  it("is reported as such, and pauses lookups for one minute", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    answerFetch(FORECAST, limited);
    expect(await look(at("2026-11-02T14:10:00Z"))).toEqual({ status: "unavailable", reason: "rate_limited" });
    resetAnswers();
    const log = answerForecast(steady(10, 90));
    expect(await look(at("2026-11-02T14:10:59Z"))).toEqual({ status: "unavailable", reason: "rate_limited" });
    expect(log.urls).toHaveLength(0);
    expect((await look(at("2026-11-02T14:11:01Z"))).status).toBe("forecast");
  });

  // @spec PLAN-WIND-014, PLAN-WIND-008
  it("wins over another failure in the same lookup", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let n = 0;
    answerFetch(FORECAST, () => (n++ === 0 ? new Response("busy", { status: 503 }) : limited()));
    expect(await look(at("2026-11-02T14:10:00Z"), ORH, 300)).toEqual({ status: "unavailable", reason: "rate_limited" });
  });
});

describe("a failed lookup's log line", () => {
  const logged = () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    return () => spy.mock.calls.map((c) => c.join(" ")).filter((l) => l.startsWith("[winds]"));
  };

  // @spec PLAN-WIND-015
  it("names the requests that failed with their HTTP status and Open-Meteo's reason", async () => {
    const lines = logged();
    let n = 0;
    answerFetch(FORECAST, (url) =>
      n++ === 0 ? Response.json({ reason: "Minutely API request limit exceeded.", error: true }, { status: 429 }) : forecastResponse(url, steady(10, 90)),
    );
    await look(at("2026-11-02T14:10:00Z"), ORH, 300);
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toContain("1 of 2 requests");
    expect(lines()[0]).toContain("HTTP 429");
    expect(lines()[0]).toContain("Minutely API request limit exceeded.");
  });

  // @spec PLAN-WIND-015
  it("says when the lookup timed out", async () => {
    const lines = logged();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    answerFetch(FORECAST, (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      }),
    );
    const p = look(at("2026-11-02T14:10:00Z"));
    await vi.advanceTimersByTimeAsync(15_000);
    await p;
    expect(lines()).toHaveLength(1);
    expect(lines()[0]).toContain("timed out after 15 s");
  });

  // @spec PLAN-WIND-015
  it("says when a node came back without a wind", async () => {
    const lines = logged();
    answerForecast((lat, lon) =>
      Math.abs(lat - 42.5) < 1e-9 && Math.abs(lon + 72) < 1e-9 ? { speed: null, direction: null } : { speed: 12, direction: 200 },
    );
    await look(at("2026-11-02T14:10:00Z"));
    expect(lines()).toEqual(["[winds] lookup failed: a node came back without a wind at any level"]);
  });
});

describe("the wind cache", () => {
  // @spec PLAN-WIND-010
  it("answers a repeated lookup within the hour without asking again, and asks again in the next hour", async () => {
    const log = answerForecast(steady(15, 300));
    await look(at("2026-11-02T14:05:00Z"));
    const first = log.urls.length;
    expect((await look(at("2026-11-02T14:50:00Z"))).status).toBe("forecast");
    expect(log.urls.length).toBe(first);
    // Moved a little: only the nodes not held yet are asked for.
    const before = totalAsked(log);
    await look(at("2026-11-02T14:51:00Z"), { lat: ORH.lat + 0.6, lon: ORH.lon });
    const moved = totalAsked(log) - before;
    expect(moved).toBeGreaterThan(0);
    expect(moved).toBeLessThan(chooseGrid({ lat: ORH.lat + 0.6, lon: ORH.lon }, 150, LEVELS.length)!.nodes.length);
    // Next hour.
    const hourBefore = totalAsked(log);
    await look(at("2026-11-02T15:00:00Z"));
    expect(totalAsked(log) - hourBefore).toBe(chooseGrid(ORH, 150, LEVELS.length)!.nodes.length);
    expect(log.urls.at(-1)!.searchParams.get("start_hour")).toBe("2026-11-02T15:00");
  });

  // @spec PLAN-WIND-010
  it("keeps the winds of the requests that answered when another failed", async () => {
    const grid = chooseGrid(ORH, 300, LEVELS.length)!;
    let n = 0;
    answerFetch(FORECAST, (url) => (n++ === 0 ? new Response("busy", { status: 503 }) : forecastResponse(url, steady(10, 180))));
    expect((await look(at("2026-11-02T14:10:00Z"), ORH, 300)).status).toBe("unavailable");
    resetAnswers();
    const log = answerForecast(steady(10, 180));
    // After the pause, only the failed request's nodes are asked for again.
    expect((await look(at("2026-11-02T14:16:00Z"), ORH, 300)).status).toBe("forecast");
    expect(totalAsked(log)).toBeLessThanOrEqual(100);
    expect(totalAsked(log)).toBeLessThan(grid.nodes.length);
  });

  // @spec PLAN-WIND-011
  it("drops an hour no lookup uses when a lookup starts", async () => {
    answerForecast(steady(15, 300));
    await look(at("2026-11-02T14:05:00Z"));
    const held = windCacheSize();
    expect(held).toBe(chooseGrid(ORH, 150, LEVELS.length)!.nodes.length * LEVELS.length);
    await look(at("2026-11-02T15:05:00Z"), { lat: 10, lon: 10 }, 60, [850]);
    expect(windCacheSize()).toBe(chooseGrid({ lat: 10, lon: 10 }, 60, 1)!.nodes.length);
  });

  // @spec PLAN-WIND-011
  it("holds at most 50,000 winds, keeping those the latest lookup used", async () => {
    const log = answerForecast(steady(20, 250));
    const now = at("2026-11-02T14:05:00Z");
    // Areas 10° of latitude and 30° of longitude apart, each as many nodes at 5 levels as 200 calls
    // allow, until well over 50,000 winds are asked for.
    const levels = PRESSURE_LEVELS_HPA.slice(0, 5);
    const origins = [-70, -60, -50, -40, -30, -20, -10, 0, 10, 20, 30, 40, 50, 60, 70].flatMap((lat) =>
      Array.from({ length: 12 }, (_, i) => ({ lat, lon: -180 + i * 30 })),
    );
    const used: { lat: number; lon: number }[] = [];
    for (const o of origins) {
      if (totalAsked(log) * levels.length >= 60_000) break;
      used.push(o);
      expect((await look(now, o, 300, levels)).status).toBe("forecast");
    }
    expect(totalAsked(log) * levels.length).toBeGreaterThan(50_000);
    expect(windCacheSize()).toBeLessThanOrEqual(50_000);
    const asked = log.urls.length;
    expect((await look(now, used.at(-1)!, 300, levels)).status).toBe("forecast");
    expect(log.urls.length).toBe(asked);
  });
});
