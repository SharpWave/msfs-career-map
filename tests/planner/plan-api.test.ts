/**
 * `GET /api/plan` with forecast winds (PLAN-FIND-007, 008, 011; PLAN-WIND-004, 008, 009, 012, 013;
 * PLAN-TIME-013): the `wind` parameter, the ring's 72 radii, candidates timed in the wind or left
 * out of reach, and the `wind` report for every outcome. Open-Meteo is answered by the test.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { answerFetch } from "../support/fetch-guard.ts";
import { FORECAST, answerForecast, steady } from "../support/open-meteo.ts";
import { startTestServer, type TestServer } from "../support/test-server.ts";
import { forgetWinds } from "../../src/server/winds.ts";

// A tripwire: nothing in this file may connect to the sim.
const simLink = vi.hoisted(() => ({ startSimLink: vi.fn() }));
vi.mock("../../src/server/simconnect.ts", () => simLink);

interface Plan {
  range_nm: number;
  ring_nm: number[];
  candidates: { ident: string; est_minutes: number; distance_nm: number }[];
  wind: { status: string; reason: string | null; hour: string | null; levels_hpa: number[]; grid_deg: number | null };
}

describe("a planner search with forecast winds", () => {
  let server: TestServer;
  let cub: number;
  let jet: number;
  beforeAll(async () => {
    server = await startTestServer();
    const create = async (body: Record<string, unknown>) => {
      const res = await fetch(`${server.base}/api/aircraft`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(201);
      return ((await res.json()) as { id: number }).id;
    };
    cub = await create({ name: "Wind test cub", livery: "N1", cruise_kts: 100, cruise_alt_ft: 3000, climb_fpm: 500, climb_kts: 70, descent_fpm: 500, overhead_min: 10 });
    jet = await create({ name: "Wind test jet", livery: "N2", cruise_kts: 480, cruise_alt_ft: 37000, climb_fpm: 2500, climb_kts: 400, descent_fpm: 2000, overhead_min: 20 });
  });
  afterAll(async () => {
    await server.close();
  });
  beforeEach(() => forgetWinds());

  const plan = async (query: string, aircraft = cub) => {
    const res = await fetch(`${server.base}/api/plan?aircraft_id=${aircraft}&from=KORH&${query}`);
    return { status: res.status, body: (await res.json()) as Plan };
  };
  const minutes = (p: Plan, ident: string) => p.candidates.find((c) => c.ident === ident)?.est_minutes;
  const currentHour = () => new Date().toISOString().slice(0, 13) + ":00Z";

  // @spec PLAN-FIND-011
  it("refuses a wind other than 0 or 1 before looking anything up", async () => {
    for (const w of ["2", "yes", "true", "-1"]) {
      const r = await plan(`max_minutes=60&wind=${w}`);
      expect(r.status, w).toBe(400);
    }
  });

  // @spec PLAN-FIND-011, PLAN-WIND-013, PLAN-TIME-013, PLAN-FIND-008
  it("times the search in still air for wind=0, with a ring of 72 equal radii and nothing looked up", async () => {
    const { status, body } = await plan("max_minutes=60&wind=0");
    expect(status).toBe(200);
    expect(body.wind).toEqual({ status: "off", reason: null, hour: null, levels_hpa: [], grid_deg: null });
    expect(body.ring_nm).toHaveLength(72);
    for (const r of body.ring_nm) expect(r).toBeCloseTo(body.range_nm, 6);
    expect(body.candidates.length).toBeGreaterThan(5);
  });

  // @spec PLAN-FIND-011, PLAN-FIND-007, PLAN-FIND-008, PLAN-WIND-013
  it("times the search in the forecast winds by default and for wind=1", async () => {
    const still = (await plan("max_minutes=60&wind=0")).body;
    const log = answerForecast(steady(40, 270)); // 40 kt from the west
    const hourBefore = currentHour();
    const { status, body } = await plan("max_minutes=60");
    expect(status).toBe(200);
    expect(log.urls.length).toBeGreaterThan(0);

    expect(body.wind.status).toBe("forecast");
    expect(body.wind.reason).toBeNull();
    expect([hourBefore, currentHour()]).toContain(body.wind.hour);
    expect(body.wind.levels_hpa).toEqual([975, 950, 925, 900]);
    expect(body.wind.grid_deg).toBe(0.5);

    expect(body.ring_nm).toHaveLength(72);
    expect(body.ring_nm[18]).toBeGreaterThan(body.ring_nm[54] + 30); // farther east than west
    expect(body.range_nm).toBe(Math.max(...body.ring_nm));

    // Boston lies east of Worcester, Westfield-Barnes west of it.
    expect(minutes(body, "KBOS")!).toBeLessThan(minutes(still, "KBOS")!);
    expect(minutes(body, "KBAF")!).toBeGreaterThan(minutes(still, "KBAF")!);
    // Still nearest first.
    const d = body.candidates.map((c) => c.distance_nm);
    expect(d).toEqual([...d].sort((a, b) => a - b));

    forgetWinds();
    const one = (await plan("max_minutes=60&wind=1")).body;
    expect(one.wind.status).toBe("forecast");
    expect(minutes(one, "KBOS")).toBe(minutes(body, "KBOS"));
  });

  // @spec PLAN-FIND-007, PLAN-TIME-009
  it("leaves out candidates the wind puts out of reach", async () => {
    answerForecast(steady(150, 90)); // 150 kt from the east, more than the cub's 100 kt
    const { body } = await plan("max_minutes=60");
    expect(body.wind.status).toBe("forecast");
    expect(minutes(body, "KBOS")).toBeUndefined();
    expect(minutes(body, "KBAF")).toBeDefined();
    const still = (await plan("max_minutes=60&wind=0")).body;
    expect(minutes(still, "KBOS")).toBeDefined();
  });

  // @spec PLAN-WIND-008, PLAN-WIND-009, PLAN-WIND-013, PLAN-TIME-013
  it("times the search in still air when the winds cannot be had, and makes no lookup for 5 minutes after", async () => {
    const still = (await plan("max_minutes=60&wind=0")).body;
    let asked = 0;
    answerFetch(FORECAST, () => {
      asked++;
      return new Response("busy", { status: 503 });
    });
    const failed = (await plan("max_minutes=60")).body;
    expect(failed.wind).toEqual({ status: "unavailable", reason: "failed", hour: null, levels_hpa: [], grid_deg: null });
    expect(failed.candidates.map((c) => [c.ident, c.est_minutes])).toEqual(still.candidates.map((c) => [c.ident, c.est_minutes]));
    for (const r of failed.ring_nm) expect(r).toBeCloseTo(still.range_nm, 6);

    const askedBefore = asked;
    const paused = (await plan("max_minutes=60")).body;
    expect(paused.wind).toEqual({ status: "unavailable", reason: "recent_failure", hour: null, levels_hpa: [], grid_deg: null });
    expect(asked).toBe(askedBefore);
  });

  // @spec PLAN-WIND-004, PLAN-WIND-013
  it("times a search too wide for the wind grid in still air without looking anything up", async () => {
    const { status, body } = await plan("max_minutes=1440", jet);
    expect(status).toBe(200);
    expect(body.wind).toEqual({ status: "unavailable", reason: "too_wide", hour: null, levels_hpa: [], grid_deg: null });
    for (const r of body.ring_nm) expect(r).toBeCloseTo(body.range_nm, 6);
  });

  // @spec PLAN-WIND-012, PLAN-WIND-013, PLAN-TIME-007
  it("looks nothing up when the time is within the overhead", async () => {
    const { status, body } = await plan("max_minutes=10");
    expect(status).toBe(200);
    expect(body.wind).toEqual({ status: "not_needed", reason: null, hour: null, levels_hpa: [], grid_deg: null });
    expect(body.ring_nm).toEqual(new Array(72).fill(0));
    expect(body.candidates).toEqual([]);
  });
});
