/**
 * The performance table's development script (scripts/aircraft-types.ts): `missing` fetches SimBrief's
 * current type list with the server's User-Agent and prints each designator the table neither holds
 * nor lists as left out (FLEET-TYPE-018); `check` checks the shipped table as the release needs it,
 * complete, printing each problem (FLEET-TYPE-001 to 008). The script's `runAircraftTypes` is called
 * directly, its output collected; SimBrief is answered through the fetch guard.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runAircraftTypes } from "../../scripts/aircraft-types.ts";
import { checkTable, missingTypes } from "../../src/server/aircraft-types-check.ts";
import { TABLE } from "../../src/server/aircraft-types.ts";
import { USER_AGENT } from "../../src/server/version.ts";
import { PERF_PRESETS } from "../../src/client/presets.ts";
import { answerFetch } from "../support/fetch-guard.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SIMBRIEF_LIST = "https://www.simbrief.com/api/inputs.list.json";

function collect() {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { log: (l: string) => out.push(l), error: (l: string) => err.push(l) }, out, err };
}

/** SimBrief's inputs.list.json holding these designators and names. */
function answerSimbrief(types: [string, string][], seen: { userAgent: string | null }[] = []): void {
  answerFetch(SIMBRIEF_LIST, (_url, init) => {
    seen.push({ userAgent: new Headers(init?.headers).get("user-agent") });
    const aircraft = Object.fromEntries(types.map(([id, name]) => [id, { id, name }]));
    return new Response(JSON.stringify({ aircraft }), { status: 200, headers: { "content-type": "application/json" } });
  });
}

/** Designators the shipped table holds or leaves out. */
const known = (): string[] => [...TABLE.entries.map((e) => e.type), ...TABLE.omitted.map((o) => o.type)];

describe("npm run aircraft-types:missing", () => {
  // @spec FLEET-TYPE-018
  it("fetches SimBrief's list with the server's User-Agent and prints each type the table lacks, with its name", async () => {
    const seen: { userAgent: string | null }[] = [];
    const list: [string, string][] = [
      ["QA01", "Test Type One"],
      ["QB02", "Test Type Two"],
      ...known().map((id): [string, string] => [id, `Known ${id}`]),
    ];
    answerSimbrief(list, seen);
    const { io, out, err } = collect();
    expect(await runAircraftTypes(["missing"], io)).toBe(0);
    expect(seen).toEqual([{ userAgent: USER_AGENT }]);
    expect(err).toEqual([]);
    const missing = missingTypes(list.map(([id]) => id), TABLE);
    expect(missing).toEqual(["QA01", "QB02"]);
    expect(out).toEqual(["2 of SimBrief's types missing from the performance table:", "  QA01  Test Type One", "  QB02  Test Type Two"]);
  });

  // @spec FLEET-TYPE-018
  it("says none are missing when the table holds or leaves out every type in SimBrief's list", async () => {
    answerSimbrief(known().map((id): [string, string] => [id, `Known ${id}`]));
    const { io, out } = collect();
    expect(await runAircraftTypes(["missing"], io)).toBe(0);
    expect(out).toEqual(["No types missing from the performance table."]);
  });

  // @spec FLEET-TYPE-018
  it("says so and exits 1 when SimBrief's list cannot be fetched", async () => {
    answerFetch(SIMBRIEF_LIST, () => new Response("busy", { status: 503 }));
    const { io, out, err } = collect();
    expect(await runAircraftTypes(["missing"], io)).toBe(1);
    expect(out).toEqual([]);
    expect(err).toHaveLength(1);
    expect(err[0]).toMatch(/^Could not fetch SimBrief's type list: /);
  });
});

describe("npm run aircraft-types:check", () => {
  // @spec FLEET-TYPE-001, FLEET-TYPE-008
  it("checks the shipped table as complete: each problem printed and exit 1, or a summary and exit 0", async () => {
    const problems = checkTable(TABLE, PERF_PRESETS, { complete: true });
    const { io, out, err } = collect();
    const code = await runAircraftTypes(["check"], io);
    if (problems.length > 0) {
      expect(code).toBe(1);
      expect(err).toEqual(problems);
    } else {
      expect(code).toBe(0);
      expect(out).toEqual([`table complete: ${TABLE.entries.length} entries, ${TABLE.omitted.length} left out`]);
    }
  });
});

describe("the script's commands", () => {
  it("prints its usage and exits 2 for an unknown command", async () => {
    const { io, err } = collect();
    expect(await runAircraftTypes(["refresh"], io)).toBe(2);
    expect(err.join("\n")).toContain("usage:");
  });

  // @spec FLEET-TYPE-018
  it("is run by npm run aircraft-types:missing and aircraft-types:check", () => {
    const scripts = JSON.parse(readFileSync(path.join(REPO, "package.json"), "utf8")).scripts as Record<string, string>;
    expect(scripts["aircraft-types:missing"]).toMatch(/scripts\/aircraft-types\.ts missing$/);
    expect(scripts["aircraft-types:check"]).toMatch(/scripts\/aircraft-types\.ts check$/);
  });
});
