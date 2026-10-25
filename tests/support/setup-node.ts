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

// Before db.ts opens anything: the inputs it will open (contract §2, §18) must be this file's own
// database. inputs.ts loads no database, so a readInputs that went wrong is caught here, not after
// db.ts has opened data/career.db. (Until inputs.ts exists there is nothing to ask.)
// @spec APP-RUN-013, APP-SRV-023
let inputsModule: typeof import("../../src/server/inputs.ts") | null = null;
try {
  inputsModule = await import("../../src/server/inputs.ts");
} catch (e) {
  // Only inputs.ts itself missing is "not written yet"; anything wrong inside it is an error.
  if (!/Cannot find module '[^']*inputs\.ts'/.test(String(e))) throw e;
}
if (inputsModule) {
  const inputs = inputsModule.currentInputs();
  if (path.resolve(inputs.dbPath) !== path.resolve(dbPath) || path.resolve(inputs.dataFolder) !== path.resolve(dir)) {
    throw new Error(
      `currentInputs() names the database ${inputs.dbPath} in ${inputs.dataFolder}, not this test file's own ${dbPath}; refusing to open it`,
    );
  }
}

// Only now may app code load. Confirm it opened this file's database and keeps its files beside it.
const { DB_PATH, IMAGES_DIR, AIRPORTS_CSV, RUNWAYS_CSV } = await import("../../src/server/db.ts");
for (const p of [DB_PATH, IMAGES_DIR, AIRPORTS_CSV, RUNWAYS_CSV]) {
  if (path.dirname(p) !== dir) throw new Error(`${p} is outside this test file's data folder ${dir}; refusing to run`);
}
// The test servers prepare the airport data from the fixture lists, never downloading: a list
// missing here is a broken setup, not something to fetch from the internet.
// @spec APP-SRV-023
const { ensureReferenceData } = await import("../../src/server/airports.ts");
await ensureReferenceData({ downloads: false });
