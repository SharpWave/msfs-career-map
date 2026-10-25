import fs from "node:fs";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

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
          exclude: ["tests/e2e/**", "tests/desktop/**"],
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
