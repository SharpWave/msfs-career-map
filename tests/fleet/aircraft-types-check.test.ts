/**
 * The performance table's record (src/server/aircraft-types-check.ts): `checkTable` names one problem per
 * broken rule of FLEET-TYPE-001 to 008, 019 and 020 — what an entry holds, each value's provenance, the
 * sources, the hosts no source may be on, the numbers' ranges, the class presets' figures, the research
 * and check dates, the designators with the snapshot's coverage (only when asked for `complete`), and
 * the values an MSFS add-on's manual may give, and each estimate's similar type — and `missingTypes` lists SimBrief's designators the table neither holds nor leaves out (TYPE-018).
 * Small fixture tables throughout; the shipped table is checked last, as it stands.
 */
import { describe, expect, it } from "vitest";
import { checkTable, FORBIDDEN_HOSTS, missingTypes } from "../../src/server/aircraft-types-check.ts";
import { BLOCK_TIME_FIELDS, NUMBER_FIELDS, TABLE, type Table, type TypeEntry } from "../../src/server/aircraft-types.ts";
import { PERF_PRESETS } from "../../src/client/presets.ts";

/** A 737-800 with published, derived and preset values and one blank (crosswind). */
function b738(): TypeEntry {
  return {
    type: "B738",
    name: "737-800",
    variant: "737-800 with winglets, CFM56-7B26",
    preset: "Airliner",
    icon: "airliner",
    researched: "2026-10-26",
    checked: "2026-10-27",
    sources: [
      { id: "acap", title: "737 Airplane Characteristics for Airport Planning", publisher: "Boeing", page: "§3.3.1, §3.4.1", url: "https://www.boeing.com/commercial/airports/plan_manuals.page" },
      { id: "tcds", title: "Type Certificate Data Sheet A16WE", publisher: "FAA", page: "Model 737-800, Note 1", url: "https://drs.faa.gov/browse/excelExternalWindow/A16WE.pdf" },
    ],
    pressurised: { value: true, kind: "published", sources: ["tcds"] },
    values: {
      cruise_kts: { value: 455, kind: "derived", sources: ["acap"], calculation: "M0.785 at FL350, ISA: 0.785 × 576.4 kt = 452.5, to the nearest 5 kt" },
      min_runway_ft: { value: 7600, kind: "derived", sources: ["acap"], calculation: "takeoff at (66,361 + 79,016) / 2 = 72,689 kg, sea level, ISA: 7,520 ft, up to the next 100 ft" },
      ceiling_ft: { value: 41000, kind: "published", sources: ["tcds"] },
      max_xwind_kts: null,
      cruise_alt_ft: { value: 35000, kind: "published", sources: ["acap"], note: "typical initial cruise" },
      climb_fpm: { value: 2000, kind: "preset" },
      climb_kts: { value: 410, kind: "preset" },
      descent_fpm: { value: 2000, kind: "preset" },
    },
  };
}

/** A 172: unpressurised, every number published. */
function c172(): TypeEntry {
  return {
    type: "C172",
    name: "Cessna 172",
    variant: "172S Skyhawk SP, Lycoming IO-360-L2A",
    preset: "Piston single",
    icon: "high-wing",
    researched: "2026-10-26",
    checked: "2026-10-26",
    sources: [{ id: "poh", title: "Model 172S Pilot's Operating Handbook", publisher: "Cessna Aircraft Company", page: "§2, §5", url: "https://support.cessna.com/custsupt/csupport/newlook/techpubs.jsp" }],
    pressurised: { value: false, kind: "published", sources: ["poh"] },
    values: {
      cruise_kts: { value: 124, kind: "published", sources: ["poh"] },
      min_runway_ft: { value: 1630, kind: "published", sources: ["poh"] },
      ceiling_ft: { value: 14000, kind: "published", sources: ["poh"] },
      max_xwind_kts: { value: 15, kind: "published", sources: ["poh"] },
      cruise_alt_ft: { value: 8000, kind: "published", sources: ["poh"] },
      climb_fpm: { value: 600, kind: "derived", sources: ["poh"], calculation: "8,000 ft / 13 min" },
      climb_kts: { value: 75, kind: "derived", sources: ["poh"], calculation: "16 nm / 13 min × 60" },
      descent_fpm: { value: 500, kind: "published", sources: ["poh"] },
    },
  };
}

/** A Caravan: unpressurised turboprop whose preset cruise altitude is lowered to 12,000 ft. */
function c208(): TypeEntry {
  return {
    type: "C208",
    name: "Cessna 208 Caravan",
    variant: "208B Grand Caravan EX, PT6A-140",
    preset: "Turboprop",
    icon: "high-wing",
    researched: "2026-10-26",
    checked: "2026-10-27",
    sources: [{ id: "spec", title: "Cessna Grand Caravan EX specification", publisher: "Textron Aviation", page: "Performance", url: "https://cessna.txtav.com/en/turboprop/grand-caravan-ex" }],
    pressurised: { value: false, kind: "published", sources: ["spec"] },
    values: {
      cruise_kts: { value: 195, kind: "published", sources: ["spec"] },
      min_runway_ft: { value: 2500, kind: "published", sources: ["spec"] },
      ceiling_ft: { value: 25000, kind: "published", sources: ["spec"] },
      max_xwind_kts: null,
      cruise_alt_ft: { value: 12000, kind: "preset" },
      climb_fpm: { value: 1500, kind: "preset" },
      climb_kts: { value: 115, kind: "preset" },
      descent_fpm: { value: 1500, kind: "preset" },
    },
  };
}

function table(): Table {
  return {
    snapshot: { date: "2026-10-25", types: ["B738", "C172", "C208", "ZZ99"] },
    omitted: [{ type: "ZZ99", reason: "no accepted source gives any of its numbers" }],
    entries: [b738(), c172(), c208()],
  };
}

const check = (t: Table, complete = false) => checkTable(t, PERF_PRESETS, { complete });

/** The problems after `mutate` changes a fresh valid table. */
function problemsAfter(mutate: (t: Table) => void, complete = false): string[] {
  const t = table();
  mutate(t);
  return check(t, complete);
}

const entry = (t: Table, type: string) => t.entries.find((e) => e.type === type)!;

/** Some problem names the type and, when given, the field. */
function expectProblem(problems: string[], type: string, field?: string): void {
  expect(problems.length).toBeGreaterThan(0);
  expect(problems.some((p) => p.includes(type) && (field === undefined || p.includes(field)))).toBe(true);
}

describe("a valid table", () => {
  // @spec FLEET-TYPE-001, FLEET-TYPE-002, FLEET-TYPE-003, FLEET-TYPE-005, FLEET-TYPE-006, FLEET-TYPE-007, FLEET-TYPE-008
  it("has no problems, complete or not", () => {
    expect(check(table())).toEqual([]);
    expect(check(table(), true)).toEqual([]);
  });

  // @spec FLEET-TYPE-001
  it("names the eight numbers in the record's order, the last four the block-time inputs", () => {
    expect(NUMBER_FIELDS).toEqual(["cruise_kts", "min_runway_ft", "ceiling_ft", "max_xwind_kts", "cruise_alt_ft", "climb_fpm", "climb_kts", "descent_fpm"]);
    expect(BLOCK_TIME_FIELDS).toEqual(["cruise_alt_ft", "climb_fpm", "climb_kts", "descent_fpm"]);
  });
});

describe("what an entry holds", () => {
  // @spec FLEET-TYPE-001
  it("needs the snapshot's date and designators", () => {
    expect(problemsAfter((t) => (t.snapshot.date = "25 Oct 2026")).some((p) => p.includes("snapshot"))).toBe(true);
    expect(problemsAfter((t) => (t.snapshot.types = [])).some((p) => p.includes("snapshot"))).toBe(true);
  });

  // @spec FLEET-TYPE-001
  it("needs a name and a variant", () => {
    expectProblem(problemsAfter((t) => (entry(t, "B738").name = " ")), "B738", "name");
    expectProblem(problemsAfter((t) => (entry(t, "B738").variant = "")), "B738", "variant");
  });

  // @spec FLEET-TYPE-001
  it("needs one of the six class presets and a built-in icon key", () => {
    expectProblem(problemsAfter((t) => ((entry(t, "B738") as { preset: string }).preset = "Widebody")), "B738", "preset");
    expectProblem(problemsAfter((t) => (entry(t, "B738").icon = "rocket")), "B738", "icon");
  });

  // @spec FLEET-TYPE-001
  it("needs all eight numbers present, blank as null", () => {
    expectProblem(
      problemsAfter((t) => delete (entry(t, "B738").values as Partial<TypeEntry["values"]>).max_xwind_kts),
      "B738",
      "max_xwind_kts",
    );
  });
});

describe("each value's provenance", () => {
  // @spec FLEET-TYPE-002
  it("refuses a kind other than published, derived or preset", () => {
    expectProblem(
      problemsAfter((t) => ((entry(t, "C172").values.cruise_kts as { kind: string }).kind = "estimated")),
      "C172",
      "cruise_kts",
    );
  });

  // @spec FLEET-TYPE-002
  it("needs a published or derived value to cite a source", () => {
    expectProblem(problemsAfter((t) => ((entry(t, "C172").values.ceiling_ft as { sources: string[] }).sources = [])), "C172", "ceiling_ft");
    expectProblem(problemsAfter((t) => ((entry(t, "C172").values.climb_fpm as { sources: string[] }).sources = [])), "C172", "climb_fpm");
  });

  // @spec FLEET-TYPE-002
  it("needs a derived value's calculation written out", () => {
    expectProblem(problemsAfter((t) => ((entry(t, "C172").values.climb_kts as { calculation: string }).calculation = " ")), "C172", "climb_kts");
  });

  // @spec FLEET-TYPE-002
  it("allows preset only on the four block-time inputs, and never on pressurised", () => {
    expectProblem(problemsAfter((t) => (entry(t, "B738").values.ceiling_ft = { value: 25000, kind: "preset" })), "B738", "ceiling_ft");
    expectProblem(problemsAfter((t) => (entry(t, "B738").values.cruise_kts = { value: 455, kind: "preset" })), "B738", "cruise_kts");
    expectProblem(problemsAfter((t) => (entry(t, "B738").values.min_runway_ft = { value: 7600, kind: "preset" })), "B738", "min_runway_ft");
    expectProblem(
      problemsAfter((t) => (entry(t, "B738").pressurised = { value: true, kind: "preset" } as unknown as TypeEntry["pressurised"])),
      "B738",
      "pressurised",
    );
  });
});

describe("the sources", () => {
  // @spec FLEET-TYPE-003
  it("needs each source's id unique, its title, publisher and page, and an http or https address", () => {
    expectProblem(problemsAfter((t) => entry(t, "B738").sources.push({ ...entry(t, "B738").sources[0] })), "B738", "acap");
    expectProblem(problemsAfter((t) => (entry(t, "B738").sources[0].title = "")), "B738", "title");
    expectProblem(problemsAfter((t) => (entry(t, "B738").sources[0].publisher = "")), "B738", "publisher");
    expectProblem(problemsAfter((t) => (entry(t, "B738").sources[0].page = "")), "B738", "page");
    expectProblem(problemsAfter((t) => (entry(t, "B738").sources[0].url = "ftp://example.com/acap.pdf")), "B738", "url");
    expectProblem(problemsAfter((t) => (entry(t, "B738").sources[0].url = "boeing.com/acap.pdf")), "B738", "url");
  });

  // @spec FLEET-TYPE-003
  it("needs every cited id listed, and every listed source cited", () => {
    expectProblem(problemsAfter((t) => ((entry(t, "C172").values.ceiling_ft as { sources: string[] }).sources = ["afm"])), "C172", "afm");
    expectProblem(
      problemsAfter((t) =>
        entry(t, "C172").sources.push({ id: "spare", title: "Brochure", publisher: "Cessna", page: "1", url: "https://cessna.txtav.com/" }),
      ),
      "C172",
      "spare",
    );
  });
});

describe("the hosts no source may be on", () => {
  // @spec FLEET-TYPE-004
  it("lists wikis, forums, sim community sites and file libraries, and the databases that forbid republishing", () => {
    for (const host of [
      "wikipedia.org",
      "wikimedia.org",
      "wikiwand.com",
      "fandom.com",
      "skybrary.aero",
      "learningzone.eurocontrol.int",
      "contentzone.eurocontrol.int",
      "pprune.org",
      "reddit.com",
      "flightsim.to",
      "forums.flightsimulator.com",
      "avsim.com",
      "x-plane.org",
      "airliners.net",
    ]) {
      expect(FORBIDDEN_HOSTS).toContain(host);
    }
  });

  // @spec FLEET-TYPE-004
  it("refuses a source on such a host or under it, and not one that only resembles it", () => {
    expectProblem(problemsAfter((t) => (entry(t, "B738").sources[0].url = "https://en.wikipedia.org/wiki/Boeing_737_Next_Generation")), "B738", "wikipedia.org");
    expectProblem(problemsAfter((t) => (entry(t, "B738").sources[0].url = "https://skybrary.aero/aircraft/b738")), "B738", "skybrary.aero");
    expectProblem(
      problemsAfter((t) => (entry(t, "B738").sources[0].url = "https://learningzone.eurocontrol.int/ilp/customs/ATCPFDB/details.aspx?ICAO=B738")),
      "B738",
      "eurocontrol",
    );
    expect(problemsAfter((t) => (entry(t, "B738").sources[0].url = "https://notwikipedia.org.example.com/acap.pdf"))).toEqual([]);
  });

  // @spec FLEET-TYPE-004
  it("refuses an add-on's manual on a sim file library, and not on its developer's own site", () => {
    expectProblem(problemsAfter((t) => (entry(t, "B738").sources[0].url = "https://flightsim.to/file/12345/b738-manual")), "B738", "flightsim.to");
    expect(problemsAfter((t) => (entry(t, "B738").sources[0].url = "https://pmdg.com/manuals/737/introduction.pdf"))).toEqual([]);
  });
});

describe("an MSFS add-on's manual", () => {
  /** A table whose 737-800 also lists an add-on's manual, marked, that `cite` makes some values cite. */
  function withManual(cite: (e: TypeEntry) => void): string[] {
    return problemsAfter((t) => {
      const e = entry(t, "B738");
      e.sources.push({
        id: "addon",
        title: "737-800 Introduction manual, rev. 2",
        publisher: "Example Simulations",
        page: "Performance, p. 42",
        url: "https://example-sims.com/docs/737-introduction.pdf",
        simManual: true,
      });
      cite(e);
    });
  }

  // @spec FLEET-TYPE-019
  it("may give the cruise speed, runway, ceiling, crosswind and pressurisation", () => {
    expect(
      withManual((e) => {
        e.values.max_xwind_kts = { value: 33, kind: "published", sources: ["addon"] };
        e.values.ceiling_ft = { value: 41000, kind: "published", sources: ["tcds", "addon"] };
        e.values.min_runway_ft = { value: 7600, kind: "derived", sources: ["acap", "addon"], calculation: "chart read at 72,689 kg" };
        e.pressurised = { value: true, kind: "published", sources: ["addon"] };
      }),
    ).toEqual([]);
    expect(
      withManual((e) => {
        e.values.cruise_kts = { value: 455, kind: "published", sources: ["addon"] };
        e.values.cruise_alt_ft = { value: 35000, kind: "published", sources: ["addon"] };
      }),
    ).toEqual([]);
  });

  // @spec FLEET-TYPE-019
  it("may give the cruise altitude only where the cruise speed cites the same manual", () => {
    expectProblem(
      withManual((e) => {
        e.values.max_xwind_kts = { value: 33, kind: "published", sources: ["addon"] };
        e.values.cruise_alt_ft = { value: 35000, kind: "published", sources: ["addon"] };
      }),
      "B738",
      "cruise_alt_ft",
    );
  });

  // @spec FLEET-TYPE-019
  it("may not give the climb rate, climb speed or descent rate", () => {
    const climbOrDescent: [keyof TypeEntry["values"], number][] = [
      ["climb_fpm", 2200],
      ["climb_kts", 410],
      ["descent_fpm", 2400],
    ];
    for (const [field, value] of climbOrDescent) {
      expectProblem(
        withManual((e) => {
          e.values.max_xwind_kts = { value: 33, kind: "published", sources: ["addon"] };
          e.values.cruise_kts = { value: 455, kind: "published", sources: ["addon"] };
          e.values[field] = { value, kind: "published", sources: ["acap", "addon"] };
        }),
        "B738",
        field,
      );
    }
  });

  // @spec FLEET-TYPE-019
  it("holds only a source marked as a manual to those values", () => {
    expect(
      problemsAfter((t) => {
        const e = entry(t, "B738");
        e.values.climb_fpm = { value: 2200, kind: "derived", sources: ["acap"], calculation: "35,000 ft / 16 min" };
      }),
    ).toEqual([]);
  });
});

describe("the numbers", () => {
  // @spec FLEET-TYPE-005
  it("needs whole numbers greater than zero", () => {
    expectProblem(problemsAfter((t) => (entry(t, "C172").values.cruise_kts!.value = 124.5)), "C172", "cruise_kts");
    expectProblem(problemsAfter((t) => (entry(t, "C172").values.max_xwind_kts!.value = 0)), "C172", "max_xwind_kts");
    expectProblem(problemsAfter((t) => (entry(t, "C172").values.descent_fpm!.value = -500)), "C172", "descent_fpm");
  });

  // @spec FLEET-TYPE-005
  it("needs each number within the range the aircraft record accepts", () => {
    const outside: [keyof TypeEntry["values"], number][] = [
      ["cruise_kts", 2001],
      ["min_runway_ft", 30001],
      ["ceiling_ft", 100001],
      ["max_xwind_kts", 101],
      ["cruise_alt_ft", 400],
      ["cruise_alt_ft", 60001],
      ["climb_fpm", 40],
      ["climb_fpm", 10001],
      ["climb_kts", 19],
      ["descent_fpm", 10001],
    ];
    for (const [field, value] of outside) {
      expectProblem(
        problemsAfter((t) => {
          const e = entry(t, "C172");
          e.values[field]!.value = value;
          // Keep the cross-checks out of the way of the range being tested.
          if (field === "cruise_kts") e.values.climb_kts!.value = 75;
          if (field === "ceiling_ft" || field === "cruise_alt_ft") e.values.ceiling_ft!.value = field === "ceiling_ft" ? value : 100000;
        }),
        "C172",
        field,
      );
    }
    expect(problemsAfter((t) => (entry(t, "C172").values.climb_kts!.value = 600))).not.toEqual([]); // above cruise
  });

  // @spec FLEET-TYPE-005
  it("needs climb speed no faster than cruise, and cruise altitude no higher than the ceiling", () => {
    expectProblem(problemsAfter((t) => (entry(t, "C172").values.climb_kts!.value = 130)), "C172", "climb_kts");
    expectProblem(problemsAfter((t) => (entry(t, "C172").values.cruise_alt_ft!.value = 15000)), "C172", "cruise_alt_ft");
    // Either one blank: nothing to compare.
    expect(problemsAfter((t) => (entry(t, "C172").values.ceiling_ft = null))).toEqual([]);
  });
});

describe("the class presets' figures", () => {
  // @spec FLEET-TYPE-006
  it("needs a preset climb rate and descent rate to be the preset's", () => {
    expectProblem(problemsAfter((t) => (entry(t, "B738").values.climb_fpm!.value = 2100)), "B738", "climb_fpm");
    expectProblem(problemsAfter((t) => (entry(t, "B738").values.descent_fpm!.value = 1500)), "B738", "descent_fpm");
  });

  // @spec FLEET-TYPE-006
  it("needs a preset climb speed to be the preset's fraction of cruise, to the nearest 5 kt", () => {
    // Airliner: 0.9 × 455 = 409.5 → 410; the old 60% figure no longer holds.
    expectProblem(problemsAfter((t) => (entry(t, "B738").values.climb_kts!.value = 275)), "B738", "climb_kts");
    // Turboprop: 0.6 × 195 = 117 → 115.
    expectProblem(problemsAfter((t) => (entry(t, "C208").values.climb_kts!.value = 120)), "C208", "climb_kts");
  });

  // @spec FLEET-TYPE-006
  it("allows no preset climb speed without a cruise speed", () => {
    expectProblem(problemsAfter((t) => (entry(t, "C208").values.cruise_kts = null)), "C208", "climb_kts");
  });

  // @spec FLEET-TYPE-006
  it("needs a preset cruise altitude to be the preset's, lowered to the ceiling and to 12,000 ft unpressurised", () => {
    // Turboprop's 24,000 ft on an unpressurised Caravan: 12,000 ft.
    expectProblem(problemsAfter((t) => (entry(t, "C208").values.cruise_alt_ft!.value = 24000)), "C208", "cruise_alt_ft");
    // Pressurised but with a lower ceiling: the ceiling.
    const lowCeiling = problemsAfter((t) => {
      const e = entry(t, "C208");
      e.pressurised = { value: true, kind: "published", sources: ["spec"] };
      e.values.ceiling_ft!.value = 20000;
      e.values.cruise_alt_ft!.value = 20000;
    });
    expect(lowCeiling).toEqual([]);
    // Pressurised, ceiling above the preset's: the preset's.
    const pressurised = problemsAfter((t) => {
      const e = entry(t, "C208");
      e.pressurised = { value: true, kind: "published", sources: ["spec"] };
      e.values.cruise_alt_ft!.value = 24000;
    });
    expect(pressurised).toEqual([]);
    // Pressurised unknown counts as unpressurised.
    expectProblem(
      problemsAfter((t) => {
        const e = entry(t, "C208");
        e.pressurised = null;
        e.values.cruise_alt_ft!.value = 24000;
      }),
      "C208",
      "cruise_alt_ft",
    );
  });
});

describe("the research and check dates", () => {
  // @spec FLEET-TYPE-007
  it("needs both as YYYY-MM-DD, the check on or after the research", () => {
    expectProblem(problemsAfter((t) => (entry(t, "B738").researched = "26/10/2026")), "B738", "researched");
    expectProblem(problemsAfter((t) => (entry(t, "B738").checked = "")), "B738", "checked");
    expectProblem(problemsAfter((t) => (entry(t, "B738").checked = "2026-10-25")), "B738", "checked");
  });

  // @spec FLEET-TYPE-007
  it("needs at least one of the eight numbers", () => {
    expectProblem(
      problemsAfter((t) => {
        const e = entry(t, "C172");
        for (const f of NUMBER_FIELDS) e.values[f] = null;
        e.sources = [];
        e.pressurised = null;
      }),
      "C172",
    );
  });
});

describe("the designators and the snapshot", () => {
  // @spec FLEET-TYPE-008
  it("needs each designator well formed and held once, entries and left-out types together", () => {
    expectProblem(problemsAfter((t) => (entry(t, "C172").type = "c172")), "c172");
    expectProblem(problemsAfter((t) => (entry(t, "C172").type = "C-172")), "C-172");
    expectProblem(problemsAfter((t) => t.entries.push(c172())), "C172");
    expectProblem(problemsAfter((t) => t.omitted.push({ type: "C172", reason: "no accepted source gives any of its numbers" })), "C172");
  });

  // @spec FLEET-TYPE-008
  it("needs a reason for each type left out", () => {
    expectProblem(problemsAfter((t) => (t.omitted[0].reason = " ")), "ZZ99");
  });

  // @spec FLEET-TYPE-008
  it("needs every entry and left-out type to be in the snapshot", () => {
    expectProblem(problemsAfter((t) => (t.snapshot.types = ["B738", "C172", "ZZ99"])), "C208");
  });

  // @spec FLEET-TYPE-008
  it("asks for every snapshot type only when the table is to be complete, naming the missing ones", () => {
    const partial = (t: Table) => {
      t.snapshot.types.push("A320", "DH8D");
    };
    expect(problemsAfter(partial)).toEqual([]);
    const problems = problemsAfter(partial, true);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join("\n")).toContain("A320");
    expect(problems.join("\n")).toContain("DH8D");
  });
});

describe("an estimated value", () => {
  /** The Caravan's runway estimated from the 172's published one. */
  const estimate = (t: Table, from = "C172", value = 1630) => {
    entry(t, "C208").values.min_runway_ft = { value, kind: "estimated", from, note: "nearest piston single by weight" };
  };

  // @spec FLEET-TYPE-002, FLEET-TYPE-020
  it("may give a cruise speed or runway equal to a sourced value of another type it names", () => {
    expect(problemsAfter((t) => estimate(t))).toEqual([]);
    // A preset climb speed is worked from an estimated cruise speed like any other: 0.6 × 124 = 74.4 → 75.
    expect(
      problemsAfter((t) => {
        const e = entry(t, "C208");
        e.values.cruise_kts = { value: 124, kind: "estimated", from: "C172", note: "same maker, nearest by weight" };
        e.values.climb_kts = { value: 75, kind: "preset" };
      }),
    ).toEqual([]);
  });

  // @spec FLEET-TYPE-002
  it("is refused on any other number and on pressurised", () => {
    expectProblem(
      problemsAfter((t) => (entry(t, "C208").values.ceiling_ft = { value: 14000, kind: "estimated", from: "C172", note: "x" })),
      "C208",
      "ceiling_ft",
    );
    expectProblem(
      problemsAfter((t) => (entry(t, "C208").values.climb_fpm = { value: 600, kind: "estimated", from: "C172", note: "x" })),
      "C208",
      "climb_fpm",
    );
    expectProblem(
      problemsAfter(
        (t) => (entry(t, "C208").pressurised = { value: false, kind: "estimated", from: "C172", note: "x" } as unknown as TypeEntry["pressurised"]),
      ),
      "C208",
      "pressurised",
    );
  });

  // @spec FLEET-TYPE-020
  it("needs the type it names to be another type the table holds, its value equal and sourced", () => {
    expectProblem(problemsAfter((t) => estimate(t, "ZZ99")), "C208", "min_runway_ft");
    expectProblem(problemsAfter((t) => estimate(t, "C208", 2500)), "C208", "min_runway_ft");
    expectProblem(problemsAfter((t) => estimate(t, "C172", 1700)), "C208", "min_runway_ft");
    // The 737-800's runway is derived: fine. Its climb rate is preset, its crosswind blank: never a base.
    expect(problemsAfter((t) => estimate(t, "B738", 7600))).toEqual([]);
    expectProblem(
      problemsAfter((t) => {
        entry(t, "C172").values.min_runway_ft = { value: 7600, kind: "estimated", from: "B738", note: "x" };
        estimate(t, "C172", 7600);
      }),
      "C208",
      "min_runway_ft",
    );
  });

  // @spec FLEET-TYPE-020
  it("needs a note saying why that type was chosen", () => {
    expectProblem(
      problemsAfter((t) => (entry(t, "C208").values.min_runway_ft = { value: 1630, kind: "estimated", from: "C172", note: " " })),
      "C208",
      "min_runway_ft",
    );
  });

  // @spec FLEET-TYPE-007
  it("never makes an entry on its own: an entry needs one number published or derived", () => {
    expectProblem(
      problemsAfter((t) => {
        const e = entry(t, "C208");
        for (const f of NUMBER_FIELDS) e.values[f] = null;
        e.values.min_runway_ft = { value: 1630, kind: "estimated", from: "C172", note: "nearest piston single by weight" };
        e.values.climb_fpm = { value: 1500, kind: "preset" };
        e.sources = [];
        e.pressurised = null;
      }),
      "C208",
    );
  });
});

describe("the types missing from the table", () => {
  // @spec FLEET-TYPE-018
  it("lists SimBrief's designators the table neither holds nor leaves out, sorted and upper-cased", () => {
    expect(missingTypes(["dh8d", "B738", "ZZ99", "A320", "C172"], table())).toEqual(["A320", "DH8D"]);
    expect(missingTypes(["B738", "C172", "C208"], table())).toEqual([]);
  });
});

describe("the shipped table", () => {
  // @spec FLEET-TYPE-001, FLEET-TYPE-002, FLEET-TYPE-003, FLEET-TYPE-004, FLEET-TYPE-005, FLEET-TYPE-006, FLEET-TYPE-007, FLEET-TYPE-008, FLEET-TYPE-019, FLEET-TYPE-020
  it("has no problems as it stands (its coverage is the release's check)", () => {
    expect(checkTable(TABLE, PERF_PRESETS, { complete: false })).toEqual([]);
  });

  // @spec FLEET-TYPE-001, FLEET-TYPE-008
  it("was built from a SimBrief list of 2026-10-25 or later holding every designator once", () => {
    expect(TABLE.snapshot.date >= "2026-10-25").toBe(true);
    expect(new Set(TABLE.snapshot.types).size).toBe(TABLE.snapshot.types.length);
    expect(TABLE.snapshot.types.length).toBeGreaterThanOrEqual(200);
  });
});
