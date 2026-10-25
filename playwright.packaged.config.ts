import { defineConfig } from "@playwright/test";

// @spec DESK-DIST-SMOKE-001
// The packaged tests (`npm run test:packaged`, which checks port 3280 first): the unpacked packaged
// build in release/win-unpacked, read in place and started through Playwright's Electron support.
// The app is the only server: no webServer. One app at a time, so one worker.
export default defineConfig({
  testDir: "tests/packaged",
  testMatch: "**/*.spec.ts",
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 120_000,
  reporter: [["list"]],
});
