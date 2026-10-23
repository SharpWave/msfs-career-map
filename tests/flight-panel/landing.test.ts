import { describe, expect, it } from "vitest";
import { hopTouchdown, shownTouchdown } from "../../src/client/landing.ts";
import type { Landing } from "../../src/client/types.ts";
import { hop, touchdown } from "../support/page-data.ts";

/** The descent rate of the touchdown shown for touchdowns at [seconds, fpm]. */
const shown = (...tds: [number, number][]) => shownTouchdown(tds.map(([sec, fpm]) => touchdown(sec, fpm, "solid")))?.fpm ?? null;

describe("which touchdown stands for a flight", () => {
  // @spec PANEL-LOOK-004
  it("is the only touchdown of a single landing", () => {
    expect(shown([0, 180])).toBe(180);
  });

  // @spec PANEL-LOOK-004
  it("is the first contact of a bounced landing, not the bounces after it", () => {
    expect(shown([0, 420], [4, 90], [9, 40])).toBe(420);
  });

  // @spec PANEL-LOOK-004
  it("keeps chained bounces in one landing while each comes less than 30 s after the one before", () => {
    expect(shown([0, 420], [20, 150], [40, 60])).toBe(420);
  });

  // @spec PANEL-LOOK-004
  it("is the final landing after a touch-and-go circuit", () => {
    expect(shown([0, 300], [300, 120])).toBe(120);
  });

  // @spec PANEL-LOOK-004
  it("is the first contact of a bounced final landing after a circuit", () => {
    expect(shown([0, 300], [300, 450], [303, 80])).toBe(450);
  });

  // @spec PANEL-LOOK-004
  it("starts a new landing at 30 s after the previous touchdown", () => {
    expect(shown([0, 300], [29.9, 120])).toBe(300);
    expect(shown([0, 300], [30, 120])).toBe(120);
  });

  // @spec PANEL-LOOK-004
  it("reads a hop's recorded touchdowns, and is nothing without any", () => {
    const bounced: Landing[] = [touchdown(0, 420, "hard"), touchdown(3, 90, "butter")];
    expect(hopTouchdown(hop({ landings: JSON.stringify(bounced) }))?.fpm).toBe(420);
    expect(hopTouchdown(hop({ landings: null }))).toBeNull();
    expect(hopTouchdown(hop({ landings: "[]" }))).toBeNull();
    expect(shownTouchdown([])).toBeNull();
  });
});
