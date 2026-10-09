/**
 * The app server for the browser tests (started by playwright.config.ts). Makes a data folder for
 * the run, keeps the server off the internet, and only then loads the app, as `npm start` would.
 * The folder is left for a later run to delete, since this process may still hold it at the end.
 */
import path from "node:path";
import { checkOwnDatabase, makeDataFolder, makeRunFolder, removeLeftovers } from "./run-folder.ts";
import { installFetchGuard } from "./fetch-guard.ts";
import { E2E_API_PORT } from "./ports.ts";

// @spec APP-RUN-012, APP-RUN-015
if (process.env.PORT !== String(E2E_API_PORT) || process.env.TRACKER_FAKE !== "1") {
  throw new Error(`start with PORT=${E2E_API_PORT} TRACKER_FAKE=1 (playwright.config.ts does)`);
}
removeLeftovers();
const { dir, dbPath } = makeDataFolder(makeRunFolder("e2e-"));
process.env.CAREER_DB = dbPath;
checkOwnDatabase(process.env.CAREER_DB, dir);
console.log(`[e2e] data folder ${path.dirname(dbPath)}`);

// @spec APP-RUN-018
// Outside services the browser tests rely on get canned answers here (answerFetch); none do yet.
installFetchGuard({ onRefused: (url) => console.log(`[e2e] refused outside request: ${url}`) });

await import("../../src/server/index.ts");
