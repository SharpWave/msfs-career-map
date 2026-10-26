/**
 * The performance table's lookups and API (src/server/aircraft-types.ts, the server's routes): the list
 * of types with the snapshot's date, ordered by designator (FLEET-TYPE-010), and one entry by a
 * designator upper-cased and trimmed, a type the table does not hold — a malformed designator
 * included — answering 404 (FLEET-TYPE-011). The lookups run on a fixture; the HTTP calls on the app
 * with the shipped table.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { TABLE, typeEntry, typeList, type Table, type TypeEntry } from "../../src/server/aircraft-types.ts";
import { startTestServer, type TestServer } from "../support/test-server.ts";

// A tripwire: nothing in this file may connect to the sim.
const simLink = vi.hoisted(() => ({ startSimLink: vi.fn() }));
vi.mock("../../src/server/simconnect.ts", () => simLink);

function entry(type: string, name: string, variant: string): TypeEntry {
  return {
    type,
    name,
    variant,
    preset: "Piston single",
    icon: "single-piston",
    researched: "2026-10-26",
    checked: "2026-10-27",
    sources: [{ id: "poh", title: `${name} Pilot's Operating Handbook`, publisher: "Maker", page: "§5", url: "https://example.com/poh.pdf" }],
    pressurised: { value: false, kind: "published", sources: ["poh"] },
    values: {
      cruise_kts: { value: 120, kind: "published", sources: ["poh"] },
      min_runway_ft: null,
      ceiling_ft: null,
      max_xwind_kts: null,
      cruise_alt_ft: null,
      climb_fpm: null,
      climb_kts: null,
      descent_fpm: null,
    },
  };
}

const FIXTURE: Table = {
  snapshot: { date: "2026-10-25", types: ["PA24", "C172", "BE36", "XX01"] },
  omitted: [{ type: "XX01", reason: "no accepted source gives any of its numbers" }],
  entries: [entry("PA24", "Piper Comanche", "PA-24-250"), entry("C172", "Cessna 172", "172S"), entry("BE36", "Bonanza A36", "A36, IO-550-B")],
};

describe("the list of types", () => {
  // @spec FLEET-TYPE-010
  it("gives the snapshot's date and each type's designator, name and variant, ordered by designator", () => {
    expect(typeList(FIXTURE)).toEqual({
      snapshot: "2026-10-25",
      types: [
        { type: "BE36", name: "Bonanza A36", variant: "A36, IO-550-B" },
        { type: "C172", name: "Cessna 172", variant: "172S" },
        { type: "PA24", name: "Piper Comanche", variant: "PA-24-250" },
      ],
    });
  });

  // @spec FLEET-TYPE-010
  it("leaves out the types the table lists as left out", () => {
    expect(typeList(FIXTURE).types.map((t) => t.type)).not.toContain("XX01");
  });
});

describe("one entry", () => {
  // @spec FLEET-TYPE-011
  it("is found by its designator upper-cased and trimmed", () => {
    expect(typeEntry(FIXTURE, "C172")).toEqual(FIXTURE.entries[1]);
    expect(typeEntry(FIXTURE, " c172 ")).toEqual(FIXTURE.entries[1]);
    expect(typeEntry(FIXTURE, "pa24")).toEqual(FIXTURE.entries[0]);
  });

  // @spec FLEET-TYPE-011
  it("keeps an estimate's similar type and note", () => {
    const t: Table = structuredClone(FIXTURE);
    t.entries[0].values.min_runway_ft = { value: 1630, kind: "estimated", from: "C172", note: "nearest piston single by weight" };
    expect(typeEntry(t, "PA24")?.values.min_runway_ft).toEqual({ value: 1630, kind: "estimated", from: "C172", note: "nearest piston single by weight" });
  });

  // @spec FLEET-TYPE-011
  it("is null for a type the table does not hold, a left-out or malformed one included", () => {
    expect(typeEntry(FIXTURE, "B738")).toBeNull();
    expect(typeEntry(FIXTURE, "XX01")).toBeNull();
    expect(typeEntry(FIXTURE, "C-172")).toBeNull();
    expect(typeEntry(FIXTURE, "C172C172")).toBeNull();
    expect(typeEntry(FIXTURE, "")).toBeNull();
  });
});

describe("the API", () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startTestServer();
  });
  afterAll(async () => {
    await server.close();
  });

  // @spec FLEET-TYPE-010
  it("lists the shipped table's types at /api/aircraft-types", async () => {
    const res = await fetch(`${server.base}/api/aircraft-types`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(typeList(TABLE));
    const body = typeList(TABLE);
    expect(body.snapshot).toBe(TABLE.snapshot.date);
    expect(body.types.map((t) => t.type)).toEqual([...TABLE.entries.map((e) => e.type)].sort());
  });

  // @spec FLEET-TYPE-011
  it("answers one entry as the table holds it, upper-casing the designator", async () => {
    const first = TABLE.entries[0];
    if (!first) return; // An empty table has no entry to ask for; the lookup's own tests cover it.
    const res = await fetch(`${server.base}/api/aircraft-types/${encodeURIComponent(` ${first.type.toLowerCase()} `)}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(first);
  });

  // @spec FLEET-TYPE-011
  it("answers 404 for a type the table does not hold, a malformed designator included", async () => {
    for (const type of ["QQ99", "B7-38", "TOOLONG1"]) {
      const res = await fetch(`${server.base}/api/aircraft-types/${encodeURIComponent(type)}`);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not in the performance table" });
    }
  });
});
