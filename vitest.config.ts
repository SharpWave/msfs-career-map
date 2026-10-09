import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

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
          exclude: ["tests/e2e/**"],
          environment: "node",
          globalSetup: ["tests/support/global-setup.ts"],
          setupFiles: ["tests/support/setup-node.ts"],
        },
      },
      {
        plugins: [react()],
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
