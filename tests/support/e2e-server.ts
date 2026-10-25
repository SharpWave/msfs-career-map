/**
 * The app server for the browser tests, started by playwright.config.ts as
 * `... e2e-server.ts --port=3180 --sim=fake --airport-downloads=off`. It refuses any other port,
 * sim or download switch and any folder argument, makes a data folder for the run, keeps the server
 * off the internet, and only then starts the server as a copy run from source on that folder.
 *
 * Playwright merges the developer's environment into this process's. The explicit arguments win
 * over `PORT`, `TRACKER_FAKE` and `CAREER_DB`, which is why no `--data` but this file's own is let
 * through. The folder is left for a later run to delete, since this process may still hold it at
 * the end.
 */
import path from "node:path";
import { makeDataFolder, makeRunFolder, removeLeftovers } from "./run-folder.ts";
import { installFetchGuard } from "./fetch-guard.ts";
import { guardDatabases } from "./server-guard.ts";
import { E2E_API_PORT } from "./ports.ts";

/** Exactly these, each given as written: a later `--port=...` would win over `--port=3180`. */
const REQUIRED = [`--port=${E2E_API_PORT}`, "--sim=fake", "--airport-downloads=off"];
/** Folders are this file's to choose: one in the run's own temp folder, never the pilot's. */
const REFUSED = ["--data", "--backups", "--program", "--offer"];

// @spec APP-RUN-012, APP-RUN-021
const args = process.argv.slice(2);
const nameOf = (arg: string) => arg.split("=")[0];
for (const arg of args) {
  if (REFUSED.some((prefix) => arg.startsWith(prefix))) {
    throw new Error(`e2e-server: refusing ${arg}: the browser-test server makes its own data folder in the run's temp folder`);
  }
  const required = REQUIRED.find((r) => nameOf(r) === nameOf(arg));
  if (required !== undefined && arg !== required) {
    throw new Error(`e2e-server: refusing ${arg}: the browser-test server runs only with ${REQUIRED.join(" ")}`);
  }
}
for (const required of REQUIRED) {
  if (!args.includes(required)) {
    throw new Error(`e2e-server: start with ${REQUIRED.join(" ")} (playwright.config.ts does); ${required} is missing`);
  }
}

// @spec APP-RUN-012, APP-RUN-015
removeLeftovers();
const { dir } = makeDataFolder(makeRunFolder("e2e-"));
console.log(`[e2e] data folder ${dir}`);

// @spec APP-RUN-018
// Outside services the browser tests rely on get canned answers here (answerFetch); none do yet.
installFetchGuard({ onRefused: (url) => console.log(`[e2e] refused outside request: ${url}`) });

// @spec APP-RUN-021
// Behind the arguments, for a server whose code is wrong: a canary CAREER_DB beside the data folder,
// which a correct server ignores since --data is given, and no database opened anywhere but in the
// data folder, so neither the canary nor the pilot's logbook in data/ can be opened.
process.env.CAREER_DB = path.join(path.dirname(dir), "canary", "career.db");
guardDatabases(dir);

// Only now may the server load: it opens the database named by --data.
const { runServer } = await import("../../src/server/server.ts");
await runServer("source", [...args, `--data=${dir}`], process.env);
