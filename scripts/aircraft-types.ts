/**
 * The performance table's development script (fleet, The Performance Table); the app never runs it.
 *
 *   npm run aircraft-types:missing   SimBrief's current types the table neither holds nor leaves out
 *   npm run aircraft-types:check     the table checked as a release needs it: complete, every rule met
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PERF_PRESETS } from "../src/client/presets.ts";
import { checkTable, missingTypes } from "../src/server/aircraft-types-check.ts";
import { TABLE } from "../src/server/aircraft-types.ts";
import { USER_AGENT } from "../src/server/version.ts";

const SIMBRIEF_LIST = "https://www.simbrief.com/api/inputs.list.json";
const USAGE = "usage: tsx scripts/aircraft-types.ts missing | check";

interface Io {
  log(line: string): void;
  error(line: string): void;
}

/** SimBrief's designators with their names, as its inputs list gives them. */
async function simbriefTypes(): Promise<Map<string, string>> {
  const res = await fetch(SIMBRIEF_LIST, {
    headers: { "user-agent": USER_AGENT, accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`.trim());
  const j = (await res.json()) as { aircraft?: Record<string, { id?: string; name?: string }> };
  const types = new Map<string, string>();
  for (const [key, v] of Object.entries(j.aircraft ?? {})) {
    const id = (v.id ?? key).toUpperCase();
    types.set(id, v.name ?? id);
  }
  return types;
}

// @spec FLEET-TYPE-018
async function missing(io: Io): Promise<number> {
  let types: Map<string, string>;
  try {
    types = await simbriefTypes();
  } catch (e) {
    io.error(`Could not fetch SimBrief's type list: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
  const ids = missingTypes([...types.keys()], TABLE);
  if (ids.length === 0) {
    io.log("No types missing from the performance table.");
    return 0;
  }
  io.log(`${ids.length} of SimBrief's types missing from the performance table:`);
  for (const id of ids) io.log(`  ${id}  ${types.get(id) ?? id}`);
  return 0;
}

function check(io: Io): number {
  const problems = checkTable(TABLE, PERF_PRESETS, { complete: true });
  for (const p of problems) io.error(p);
  if (problems.length > 0) return 1;
  io.log(`table complete: ${TABLE.entries.length} entries, ${TABLE.omitted.length} left out`);
  return 0;
}

/** Runs one command; the exit code. */
export async function runAircraftTypes(argv: string[], io: Io): Promise<number> {
  switch (argv[0]) {
    case "missing":
      return missing(io);
    case "check":
      return check(io);
    default:
      io.error(USAGE);
      return 2;
  }
}

const runDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (runDirectly) {
  process.exitCode = await runAircraftTypes(process.argv.slice(2), { log: (l) => console.log(l), error: (l) => console.error(l) });
}
