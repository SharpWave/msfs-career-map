/**
 * SimBrief in and out, as pure functions: the dispatch link carrying the aircraft's airline
 * (SB-LINK-001, src/client/simbrief.ts), the plan's departure and arrival positions read from both
 * OFP shapes (SB-OFP-003, src/server/ofp.ts), and which of a plan's airports get a circle on the map
 * (SB-ROUTE-005, src/client/simbrief.ts).
 */
import { describe, expect, it } from "vitest";
import { legFor, planAirports, simbriefUrl } from "../../src/client/simbrief.ts";
import type { Airport, BriefingSummary } from "../../src/client/types.ts";
import { parseOfp } from "../../src/server/ofp.ts";
import { aircraft } from "../support/page-data.ts";

const airport = (ident: string, icao_code: string | null = ident) => ({ ident, icao_code }) as Airport;

describe("the SimBrief dispatch link", () => {
  // @spec SB-LINK-001
  it("fills the airline box from the aircraft's airline designator", () => {
    const url = new URL(simbriefUrl(legFor(airport("KBOS"), airport("KPVD"), aircraft({ simbrief_type: "A320", airline: "JBU" }))));
    expect(url.origin + url.pathname).toBe("https://dispatch.simbrief.com/options/custom");
    expect(url.searchParams.get("orig")).toBe("KBOS");
    expect(url.searchParams.get("dest")).toBe("KPVD");
    expect(url.searchParams.get("type")).toBe("A320");
    expect(url.searchParams.get("airline")).toBe("JBU");
    expect(url.searchParams.has("fl")).toBe(false);
  });

  // @spec SB-LINK-001
  it("has no airline when the aircraft has none, or there is no aircraft", () => {
    expect(new URL(simbriefUrl(legFor(airport("KBOS"), airport("KPVD"), aircraft({ airline: null })))).searchParams.has("airline")).toBe(false);
    expect(new URL(simbriefUrl(legFor(airport("KBOS"), airport("KPVD"), undefined))).searchParams.has("airline")).toBe(false);
  });
});

describe("a plan's departure and arrival positions", () => {
  // @spec SB-OFP-003
  it("are read from SimBrief's v2 shape and the older all-strings one", () => {
    const v2 = parseOfp({ origin: { icao_code: "KBOS", pos_lat: 42.3643, pos_long: -71.0052 }, destination: { icao_code: "KPVD", pos_lat: 41.7232, pos_long: -71.4282 } });
    expect(v2.summary.origin).toMatchObject({ icao: "KBOS", lat: 42.3643, lon: -71.0052 });
    expect(v2.summary.dest).toMatchObject({ icao: "KPVD", lat: 41.7232, lon: -71.4282 });
    const old = parseOfp({ origin: { icao_code: "KBOS", pos_lat: "42.364300", pos_long: "-71.005200" }, destination: { icao_code: "KPVD", pos_lat: "41.723200", pos_long: "-71.428200" } });
    expect(old.summary.origin).toMatchObject({ lat: 42.3643, lon: -71.0052 });
    expect(old.summary.dest).toMatchObject({ lat: 41.7232, lon: -71.4282 });
  });

  // @spec SB-OFP-003
  it("are unknown when SimBrief gives none, or none that is a number", () => {
    const p = parseOfp({ origin: { icao_code: "KBOS" }, destination: { icao_code: "KPVD", pos_lat: "", pos_long: "west" } });
    expect(p.summary.origin).toMatchObject({ lat: null, lon: null });
    expect(p.summary.dest).toMatchObject({ lat: null, lon: null });
  });
});

describe("the plan's airports marked on the map", () => {
  const plan = (origin: Partial<BriefingSummary["origin"]>, dest: Partial<BriefingSummary["dest"]>) =>
    ({
      origin: { icao: "KBOS", name: null, rwy: null, lat: 42.3643, lon: -71.0052, ...origin },
      dest: { icao: "KPVD", name: null, rwy: null, lat: 41.7232, lon: -71.4282, ...dest },
    }) as BriefingSummary;

  // @spec SB-ROUTE-005
  it("are the origin and destination at the positions the plan gives", () => {
    expect(planAirports(plan({}, {}))).toEqual([
      { icao: "KBOS", lat: 42.3643, lon: -71.0052 },
      { icao: "KPVD", lat: 41.7232, lon: -71.4282 },
    ]);
  });

  // @spec SB-ROUTE-005
  it("leave out an airport the plan gives no position for", () => {
    expect(planAirports(plan({ lat: null }, {}))).toEqual([{ icao: "KPVD", lat: 41.7232, lon: -71.4282 }]);
    expect(planAirports(plan({}, { lon: null }))).toEqual([{ icao: "KBOS", lat: 42.3643, lon: -71.0052 }]);
    // A plan stored before plans carried positions.
    const older = { origin: { icao: "KBOS", name: null, rwy: null }, dest: { icao: "KPVD", name: null, rwy: null } } as unknown as BriefingSummary;
    expect(planAirports(older)).toEqual([]);
  });

  // @spec SB-ROUTE-005
  it("are one circle when origin and destination share a position", () => {
    expect(planAirports(plan({}, { icao: "KBOS", lat: 42.3643, lon: -71.0052 }))).toEqual([{ icao: "KBOS", lat: 42.3643, lon: -71.0052 }]);
  });

  // @spec SB-ROUTE-005
  it("are none without a plan", () => {
    expect(planAirports(null)).toEqual([]);
    expect(planAirports(undefined)).toEqual([]);
  });
});
