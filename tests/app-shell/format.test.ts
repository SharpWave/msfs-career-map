import { describe, expect, it } from "vitest";
import { aircraftLabel, fmtDateTime, fmtDuration, fmtFt, fmtNm, fmtTimeShort } from "../../src/client/format.ts";

describe("shared formatting", () => {
  // @spec APP-FMT-001
  it("writes durations as Nm under an hour and Nh MMm from an hour", () => {
    expect(fmtDuration(0)).toBe("0m");
    expect(fmtDuration(45)).toBe("45m");
    expect(fmtDuration(60)).toBe("1h 00m");
    expect(fmtDuration(65)).toBe("1h 05m");
    expect(fmtDuration(605)).toBe("10h 05m");
    expect(fmtDuration(null)).toBe("");
  });

  // @spec APP-FMT-001
  it("writes distances and heights rounded to whole units with thousands separators", () => {
    expect(fmtNm(1234.4)).toMatch(/^1.234 nm$/);
    expect(fmtNm(87.6)).toBe("88 nm");
    expect(fmtFt(6500.4)).toMatch(/^6.500 ft$/);
    expect(fmtFt(950)).toBe("950 ft");
  });

  // @spec APP-FMT-002
  it("writes dates in full with the year and in short form without it", () => {
    const iso = "2026-07-15T14:05:00Z";
    const full = fmtDateTime(iso);
    const short = fmtTimeShort(iso);
    expect(full).toContain("2026");
    expect(full).toMatch(/\d:\d\d/);
    expect(short).not.toContain("2026");
    expect(short).toMatch(/\d:\d\d/);
    expect(fmtDateTime(null)).toBe("");
  });

  // @spec APP-FMT-003
  it("names an aircraft Name · Livery, or Name without a livery", () => {
    expect(aircraftLabel({ name: "Cessna 172", livery: "N123AB" })).toBe("Cessna 172 · N123AB");
    expect(aircraftLabel({ name: "Cessna 172", livery: "" })).toBe("Cessna 172");
  });
});
