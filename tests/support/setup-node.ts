/**
 * Runs before each Node test file, in that file's own process. It must not import app code
 * statically: db.ts opens CAREER_DB the moment it loads, so CAREER_DB is set and checked first.
 */
import path from "node:path";
import { afterEach, inject } from "vitest";
import { checkOwnDatabase, makeDataFolder } from "./run-folder.ts";
import { installFetchGuard, resetAnswers, takeRefused } from "./fetch-guard.ts";

// @spec APP-RUN-011, APP-RUN-013
const { dir, dbPath } = makeDataFolder(inject("runDir"));
process.env.CAREER_DB = dbPath;
delete process.env.TRACKER_FAKE;
checkOwnDatabase(process.env.CAREER_DB, dir);

// @spec APP-RUN-014
installFetchGuard();
afterEach(() => {
  resetAnswers();
  const refused = takeRefused();
  if (refused.length > 0) {
    throw new Error(`outside request(s) refused: ${refused.join(", ")} — answer them with answerFetch()`);
  }
});

// Only now may app code load. Confirm it opened this file's database and keeps its files beside it.
const { DB_PATH, IMAGES_DIR, AIRPORTS_CSV, RUNWAYS_CSV } = await import("../../src/server/db.ts");
for (const p of [DB_PATH, IMAGES_DIR, AIRPORTS_CSV, RUNWAYS_CSV]) {
  if (path.dirname(p) !== dir) throw new Error(`${p} is outside this test file's data folder ${dir}; refusing to run`);
}
const { ensureReferenceData } = await import("../../src/server/airports.ts");
await ensureReferenceData();
