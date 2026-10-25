/**
 * `npm run desktop`: the desktop build, then Electron on it, unpackaged, in test mode on `.desktop-dev`
 * in the repository (port 3280, the fake feed, airport downloads off), exiting with Electron's code.
 *
 *   npm run desktop              # rebuild build/desktop, keeping its seed lists, and start the app
 *   npm run desktop -- --fresh   # the same, downloading the seed lists afresh
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { buildDesktop, buildOptions, electronCommand } from "./desktop-build.ts";

// @spec DESK-DIST-DEV-001, DESK-DIST-DEV-005
const options = buildOptions(process.argv.slice(2));
await buildDesktop(options);

// The electron package's main is the path to its binary.
const electronPath = createRequire(import.meta.url)("electron") as string;
const c = electronCommand(options.repo, electronPath, process.env);
console.log(`[desktop] starting Electron on ${c.args.join(" ")}`);
const child = spawn(c.command, c.args, { env: c.env, stdio: "inherit" });
child.on("error", (e) => {
  console.error(`[desktop] Electron did not start: ${e.message}`);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 1));
