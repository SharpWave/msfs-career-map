/**
 * What a tour adds up to (src/client/tour.ts): a hop's distance and fuel burned, the tour block's
 * totals, tour facts and landing summary, and a plan's figures beside a hop's.
 */
import { describe, expect, it } from "vitest";
import { distanceNm } from "../../src/client/geo.ts";
import { digestEntry, hopFigures, plannedFigures, tourRows, tourSummary } from "../../src/client/tour.ts";
import type { Hop, HopStats, PlanDigestEntry } from "../../src/client/types.ts";
import { airport, hop, touchdown } from "../support/page-data.ts";

const AIRPORTS = Object.fromEntries(["KBOS", "KPVD", "KHYA", "KACK"].map((i) => [i, airport(i)]));
const direct = (a: string, b: string) => distanceNm([AIRPORTS[a].lat, AIRPORTS[a].lon], [AIRPORTS[b].lat, AIRPORTS[b].lon]);

const stats = (over: Partial<HopStats>): string =>
  JSON.stringify({
    fuel_start_lb: null,
    fuel_end_lb: null,
    fuel_used_lb: null,
    weight_start_lb: null,
    weight_end_lb: null,
    max_alt_ft: null,
    max_gs_kts: null,
    flown_nm: null,
    ...over,
  } satisfies HopStats);

describe("a hop's distance", () => {
  // @spec ACP-TOUR-003
  it("is the distance flown recorded with the hop when that is above zero", () => {
    const f = hopFigures(hop({ stats: stats({ flown_nm: 51.4 }) }), AIRPORTS);
    expect(f.distanceNm).toBe(51.4);
    expect(f.distanceKind).toBe("flown");
  });

  // @spec ACP-TOUR-003
  it("is the direct distance between its airports for a hand-logged hop, and for a track too short to measure", () => {
    for (const s of [null, stats({ flown_nm: 0 }), stats({ flown_nm: null }), "not json"]) {
      const f = hopFigures(hop({ origin: "KBOS", dest: "KPVD", stats: s }), AIRPORTS);
      expect(f.distanceKind, String(s)).toBe("direct");
      expect(f.distanceNm, String(s)).toBeCloseTo(direct("KBOS", "KPVD"), 6);
    }
    expect(direct("KBOS", "KPVD")).toBeGreaterThan(40);
    expect(direct("KBOS", "KPVD")).toBeLessThan(46);
  });

  // @spec ACP-TOUR-003
  it("is unknown when the map state lacks one of its airports", () => {
    const f = hopFigures(hop({ origin: "KBOS", dest: "ZZZZ" }), AIRPORTS);
    expect(f.distanceNm).toBeNull();
    expect(f.distanceKind).toBeNull();
  });

  // @spec ACP-TOUR-003
  it("is zero, direct, for a hop that leaves from and returns to the same airport by hand", () => {
    const f = hopFigures(hop({ origin: "KBOS", dest: "KBOS" }), AIRPORTS);
    expect(f.distanceNm).toBe(0);
    expect(f.distanceKind).toBe("direct");
  });
});

describe("a hop's fuel burned", () => {
  // @spec ACP-TOUR-005
  it("is the fuel used recorded with the hop when that is above zero", () => {
    expect(hopFigures(hop({ stats: stats({ fuel_used_lb: 412.6 }) }), AIRPORTS).fuelLb).toBe(412.6);
  });

  // @spec ACP-TOUR-005
  it("is none for a hand-logged hop, an aircraft reporting no fuel, or one refuelled in the air", () => {
    for (const s of [null, stats({ fuel_used_lb: null }), stats({ fuel_used_lb: 0 }), stats({ fuel_used_lb: -85 })]) {
      expect(hopFigures(hop({ stats: s }), AIRPORTS).fuelLb, String(s)).toBeNull();
    }
  });
});

describe("a hop's other figures", () => {
  // @spec ACP-LIST-003
  it("takes the departure as when it was flown, else the arrival, else nothing", () => {
    const dep = "2026-10-25T23:14:00.000Z";
    const arr = "2026-10-26T01:12:00.000Z";
    expect(hopFigures(hop({ departed_at: dep, arrived_at: arr }), AIRPORTS).when).toBe(dep);
    expect(hopFigures(hop({ arrived_at: arr }), AIRPORTS).when).toBe(arr);
    expect(hopFigures(hop(), AIRPORTS).when).toBeNull();
  });

  // @spec ACP-LIST-002
  it("takes the stored flight time, else the one derived from its times", () => {
    expect(hopFigures(hop({ duration_min: 58 }), AIRPORTS).durationMin).toBe(58);
    expect(hopFigures(hop({ departed_at: "2026-10-25T23:14:00.000Z", arrived_at: "2026-10-26T01:12:00.000Z" }), AIRPORTS).durationMin).toBe(118);
    expect(hopFigures(hop(), AIRPORTS).durationMin).toBeNull();
  });

  // @spec ACP-LIST-002, PANEL-LOOK-004
  it("takes the first touchdown of the final landing as the hop's landing", () => {
    const landings = [touchdown(0, 300, "solid"), touchdown(300, 450, "hard"), touchdown(303, 80, "butter")];
    expect(hopFigures(hop({ landings: JSON.stringify(landings) }), AIRPORTS).touchdown?.fpm).toBe(450);
    expect(hopFigures(hop(), AIRPORTS).touchdown).toBeNull();
  });
});

describe("the tour block's figures", () => {
  const TOUR: Hop[] = [
    // hand-logged, no times
    hop({ id: 11, seq: 1, origin: "KBOS", dest: "KPVD" }),
    // tracked
    hop({
      id: 12,
      seq: 2,
      origin: "KPVD",
      dest: "KHYA",
      departed_at: "2026-10-20T14:00:00.000Z",
      arrived_at: "2026-10-20T14:40:00.000Z",
      duration_min: 38,
      stats: stats({ flown_nm: 61.2, fuel_used_lb: 100.4 }),
      landings: JSON.stringify([touchdown(0, 90, "butter")]),
    }),
    // tracked, bounced
    hop({
      id: 13,
      seq: 3,
      origin: "KHYA",
      dest: "KACK",
      departed_at: "2026-10-25T23:14:00.000Z",
      arrived_at: "2026-10-25T23:44:00.000Z",
      stats: stats({ flown_nm: 30, fuel_used_lb: 61 }),
      landings: JSON.stringify([touchdown(0, 310, "hard"), touchdown(4, 60, "butter")]),
    }),
    // tracked, no fuel reported, back where it came from
    hop({
      id: 14,
      seq: 4,
      origin: "KACK",
      dest: "KHYA",
      arrived_at: "2026-11-02T18:05:00.000Z",
      duration_min: 20,
      stats: stats({ flown_nm: 31, fuel_used_lb: 0 }),
      landings: JSON.stringify([touchdown(0, 85, "butter")]),
    }),
  ];
  const summary = () => tourSummary(tourRows(TOUR, AIRPORTS));

  // @spec ACP-TOUR-002
  it("counts the hops and sums their flight times, stored or derived, a hop without one counting 0", () => {
    const s = summary();
    expect(s.hops).toBe(4);
    expect(s.loggedMin).toBe(38 + 30 + 20);
  });

  // @spec ACP-TOUR-004
  it("sums each hop's distance, flown where recorded and direct otherwise", () => {
    expect(summary().distanceNm).toBeCloseTo(direct("KBOS", "KPVD") + 61.2 + 30 + 31, 6);
  });

  // @spec ACP-TOUR-004
  it("counts a hop without a distance as 0", () => {
    const s = tourSummary(tourRows([...TOUR, hop({ id: 15, seq: 5, origin: "KHYA", dest: "ZZZZ" })], AIRPORTS));
    expect(s.distanceNm).toBeCloseTo(summary().distanceNm, 6);
  });

  // @spec ACP-TOUR-006
  it("sums the fuel burned over the hops that have a fuel figure, and says how many do", () => {
    const s = summary();
    expect(s.fuelLb).toBeCloseTo(161.4, 6);
    expect(s.fuelHops).toBe(2);
  });

  // @spec ACP-TOUR-006
  it("has no fuel total when no hop has a fuel figure", () => {
    const s = tourSummary(tourRows([TOUR[0], TOUR[3]], AIRPORTS));
    expect(s.fuelLb).toBeNull();
    expect(s.fuelHops).toBe(0);
  });

  // @spec ACP-TOUR-007
  it("counts the different airports among origins and destinations", () => {
    expect(summary().airports).toBe(4);
    expect(tourSummary(tourRows([hop({ origin: "KBOS", dest: "KBOS" })], AIRPORTS)).airports).toBe(1);
  });

  // @spec ACP-TOUR-008
  it("gives the earliest and latest hop time, a hop's time being its departure, else its arrival", () => {
    const s = summary();
    expect(s.first).toBe("2026-10-20T14:00:00.000Z");
    expect(s.latest).toBe("2026-11-02T18:05:00.000Z");
  });

  // @spec ACP-TOUR-008
  it("gives no dates when no hop has a time", () => {
    const s = tourSummary(tourRows([TOUR[0]], AIRPORTS));
    expect(s.first).toBeNull();
    expect(s.latest).toBeNull();
  });

  // @spec ACP-TOUR-009
  it("names the hop with the greatest distance as the longest", () => {
    expect(summary().longest?.hop.id).toBe(12);
  });

  // @spec ACP-TOUR-009
  it("takes the later hop in tour order on a tie, and none when no hop has a distance", () => {
    const tied = [
      hop({ id: 21, seq: 1, stats: stats({ flown_nm: 50 }) }),
      hop({ id: 22, seq: 2, stats: stats({ flown_nm: 50 }) }),
      hop({ id: 23, seq: 3, stats: stats({ flown_nm: 12 }) }),
    ];
    expect(tourSummary(tourRows(tied, AIRPORTS)).longest?.hop.id).toBe(22);
    expect(tourSummary(tourRows([hop({ origin: "ZZZZ", dest: "KBOS" })], AIRPORTS)).longest).toBeNull();
  });

  // @spec ACP-TOUR-010, PANEL-LOOK-004
  it("averages the descent rate of the touchdown that stands for each hop and counts each rating, best first", () => {
    const s = summary();
    expect(s.landings.count).toBe(3);
    // 90 (butter), 310 (hard: the first touchdown of the bounced landing), 85 (butter)
    expect(s.landings.avgFpm).toBe(Math.round((90 + 310 + 85) / 3));
    expect(s.landings.byRating).toEqual([
      { rating: "butter", count: 2 },
      { rating: "hard", count: 1 },
    ]);
  });

  // @spec ACP-TOUR-010
  it("has no landing summary when no hop has a touchdown", () => {
    const s = tourSummary(tourRows([TOUR[0]], AIRPORTS));
    expect(s.landings).toEqual({ count: 0, avgFpm: null, byRating: [] });
  });

  // @spec ACP-TOUR-002
  it("is all zeroes and nulls for an aircraft without hops", () => {
    expect(tourSummary([])).toEqual({
      hops: 0,
      loggedMin: 0,
      distanceNm: 0,
      fuelLb: null,
      fuelHops: 0,
      airports: 0,
      first: null,
      latest: null,
      longest: null,
      landings: { count: 0, avgFpm: null, byRating: [] },
    });
  });
});

describe("a plan's figures beside a hop's", () => {
  const entry = (over: Partial<PlanDigestEntry> = {}): PlanDigestEntry => ({
    hop_id: 12,
    id: 7,
    ete_min: 112,
    fuel: { units: "lbs", burn: 398 },
    pdf_url: "https://www.simbrief.com/ofp/flightplans/KPVDKHYA_PDF_1.pdf",
    ...over,
  });

  // @spec ACP-PLAN-005
  it("gives a burn in pounds as it is, and one in kilograms converted at 2.20462 and rounded", () => {
    expect(plannedFigures(entry())).toEqual({ eteMin: 112, burnLb: 398 });
    expect(plannedFigures(entry({ fuel: { units: "kgs", burn: 500 } })).burnLb).toBe(1102);
    expect(plannedFigures(entry({ fuel: { units: "lbs", burn: 398.6 } })).burnLb).toBe(399);
  });

  // @spec ACP-PLAN-005
  it("gives no planned burn for a plan in any other unit, or without one", () => {
    for (const fuel of [
      { units: "gal", burn: 60 },
      { units: null, burn: 60 },
      { units: "lbs", burn: null },
    ]) {
      expect(plannedFigures(entry({ fuel })).burnLb, JSON.stringify(fuel)).toBeNull();
    }
    expect(plannedFigures(entry({ ete_min: null })).eteMin).toBeNull();
  });

  // @spec ACP-PLAN-003
  it("uses a digest entry only while its plan is the one the hop links to", () => {
    const digest = [entry()];
    expect(digestEntry(hop({ id: 12, briefing_id: 7 }), digest)).toBe(digest[0]);
    // the hop's plan was replaced or removed since the digest was asked for
    expect(digestEntry(hop({ id: 12, briefing_id: 8 }), digest)).toBeNull();
    expect(digestEntry(hop({ id: 12, briefing_id: null }), digest)).toBeNull();
    expect(digestEntry(hop({ id: 13, briefing_id: 7 }), digest)).toBeNull();
    expect(digestEntry(hop({ id: 12, briefing_id: 7 }), null)).toBeNull();
  });
});
