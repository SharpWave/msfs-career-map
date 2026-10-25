import fs from "node:fs";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * The wall-clock tests of a large airport import, which measure how long the server's event loop is
 * held. With CAREER_MAP_TIMED_TESTS=apart the node project leaves them out, for a run that then gives
 * them the machine alone (the release workflow: a 4-core runner busy with every other file measures
 * those files too). Vitest's own --exclude does not reach a project's files.
 */
const TIMED_TESTS = ["tests/airports/import.test.ts", "tests/app-shell/server-airports.test.ts"];
const timedApart = process.env.CAREER_MAP_TIMED_TESTS === "apart" ? TIMED_TESTS : [];

/** The app's version, built into the page as vite.config.ts builds it in (APP-API-005). */
const version: string = JSON.parse(fs.readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;

// Nothing here may import from src/server: db.ts opens the database the moment it loads, and this
// file is evaluated before any test file has its own data folder (APP-RUN-013).
export default defineConfig({
  test: {
    // A fresh process per test file, so no module or open database carries over between files.
    pool: "forks",
    isolate: true,
    execArgv: ["--no-warnings=ExperimentalWarning"],
    onConsoleLog: (log) => !log.startsWith("[data]"),
    projects: [
      {
        test: {
          name: "node",
          include: ["tests/**/*.test.ts"],
          exclude: ["tests/e2e/**", "tests/desktop/**", "tests/installer/**", "tests/packaged/**", ...timedApart],
          environment: "node",
          globalSetup: ["tests/support/global-setup.ts"],
          setupFiles: ["tests/support/setup-node.ts"],
        },
      },
      {
        // The desktop shell's unit tests: no database, and every way out of the process guarded
        // (DESK-SHELL-TEST-001).
        define: { __MSFS_CAREER_MAP_VERSION__: JSON.stringify(version) },
        test: {
          name: "desktop",
          include: ["tests/desktop/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/support/global-setup.ts"],
          setupFiles: ["tests/desktop/support/guard.ts"],
        },
      },
      {
        plugins: [react()],
        define: { __MSFS_CAREER_MAP_VERSION__: JSON.stringify(version) },
        test: {
          name: "components",
          include: ["tests/**/*.test.tsx"],
          exclude: ["tests/e2e/**"],
          environment: "jsdom",
          setupFiles: ["tests/support/setup-dom.ts"],
        },
      },
    ],
  },
});
