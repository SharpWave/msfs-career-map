/**
 * `npm run test:packaged`: the packaged smoke test and the packaged layout check (tests/packaged/) on the
 * unpacked build in release/, once port 3280 is found free, with Playwright run without
 * ELECTRON_RUN_AS_NODE. `npm run package` builds what it tests.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SMOKE_PORT = 3280;

export const PORT_HELD_MESSAGE = `Port ${SMOKE_PORT} is in use, so the packaged smoke test cannot run its test-mode copy there. The likely holder is npm run desktop, which uses the same port: close that app first.`;

/**
 * electron-builder's output the packaged tests read: `release/`, or the folder `CAREER_MAP_RELEASE` names
 * (for a build made with `--config.directories.output=<folder>` while `release/` is held open, as VS
 * Code's extension host can hold an `app.asar` it has looked into).
 */
export function releaseFolder(repo: string, env: NodeJS.ProcessEnv = process.env): string {
  return env.CAREER_MAP_RELEASE ? path.resolve(repo, env.CAREER_MAP_RELEASE) : path.join(repo, "release");
}

/** Whether 127.0.0.1:<port> can be listened on now. */
export function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

/** The environment without ELECTRON_RUN_AS_NODE, however it is written, which would make Electron run as plain Node. */
// @spec DESK-DIST-DEV-005
export function packagedEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const kept: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && key.toUpperCase() !== "ELECTRON_RUN_AS_NODE") kept[key] = value;
  }
  return kept;
}

// @spec DESK-DIST-SMOKE-001, DESK-DIST-SMOKE-012
async function main(): Promise<number> {
  const repo = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  const unpacked = path.join(releaseFolder(repo), "win-unpacked");
  if (!fs.existsSync(path.join(unpacked, "MSFS Career Map.exe"))) {
    console.error(`The unpacked packaged build is missing from ${unpacked}: run npm run package first.`);
    return 1;
  }
  if (!(await portFree(SMOKE_PORT))) {
    console.error(PORT_HELD_MESSAGE);
    return 1;
  }
  const playwright = path.join(repo, "node_modules", "@playwright", "test", "cli.js");
  const child = spawn(process.execPath, [playwright, "test", "-c", "playwright.packaged.config.ts", ...process.argv.slice(2)], {
    cwd: repo,
    env: packagedEnv(process.env),
    stdio: "inherit",
  });
  return new Promise((resolve) => child.on("exit", (code) => resolve(code ?? 1)));
}

const runDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (runDirectly) process.exit(await main());
