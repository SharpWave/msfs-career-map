/**
 * Temporary data folders for test runs. Nothing here imports app code: these run before any
 * app module may load, since db.ts opens its database the moment it is imported.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const TEST_FOLDER_PREFIX = "msfs-career-map-test-";
export const FIXTURES_DIR = path.resolve(import.meta.dirname, "..", "fixtures");
const DAY_MS = 24 * 3600_000;

/** A new folder for one run, in the system's temp directory. */
export function makeRunFolder(kind = ""): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${TEST_FOLDER_PREFIX}${kind}`));
}

/** A data folder inside `parent`: the fixture lists, and the path a new database will take. */
export function makeDataFolder(parent: string): { dir: string; dbPath: string } {
  const dir = fs.mkdtempSync(path.join(parent, "data-"));
  fs.copyFileSync(path.join(FIXTURES_DIR, "airports.csv"), path.join(dir, "airports.csv"));
  fs.copyFileSync(path.join(FIXTURES_DIR, "runways.csv"), path.join(dir, "runways.csv"));
  return { dir, dbPath: path.join(dir, "career.db") };
}

/** Throws unless `careerDb` names a database directly inside `ownDir`. */
// @spec APP-RUN-013
export function checkOwnDatabase(careerDb: string | undefined, ownDir: string): void {
  if (!careerDb) throw new Error("CAREER_DB is not set; refusing to let a test open the real logbook");
  const db = path.resolve(careerDb);
  if (path.dirname(db) !== path.resolve(ownDir)) {
    throw new Error(`CAREER_DB ${db} is not in this test's own data folder ${ownDir}; refusing to open it`);
  }
}

/**
 * Deletes test folders in `root` more than a day old, left by a crashed run or a file the system
 * held open. Younger ones may belong to a run still going. Returns the folders deleted.
 */
// @spec APP-RUN-015
export function removeLeftovers(root = os.tmpdir(), now = Date.now(), maxAgeMs = DAY_MS): string[] {
  const removed: string[] = [];
  let names: string[];
  try {
    names = fs.readdirSync(root);
  } catch {
    return removed;
  }
  for (const name of names) {
    if (!name.startsWith(TEST_FOLDER_PREFIX)) continue;
    const dir = path.join(root, name);
    try {
      const st = fs.statSync(dir);
      if (!st.isDirectory() || now - st.mtimeMs <= maxAgeMs) continue;
      fs.rmSync(dir, { recursive: true, force: true });
      removed.push(dir);
    } catch {
      // Still held open, or already gone: a later run tries again.
    }
  }
  return removed;
}

let counts: { airports: number; runways: number } | null = null;

/** What the fixture lists load: every airport but the closed ones, and every runway. */
export function fixtureCounts(): { airports: number; runways: number } {
  if (counts) return counts;
  const rows = (file: string) => fs.readFileSync(path.join(FIXTURES_DIR, file), "utf8").split(/\r?\n/).slice(1).filter(Boolean);
  // The type is the third column; OurAirports quotes every text field.
  const airports = rows("airports.csv").filter((line) => !/^[^,]*,"[^"]*","closed",/.test(line)).length;
  counts = { airports, runways: rows("runways.csv").length };
  return counts;
}
