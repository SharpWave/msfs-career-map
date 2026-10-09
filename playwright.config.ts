import { defineConfig, devices } from "@playwright/test";
import { E2E_API_PORT, E2E_PAGE_PORT } from "./tests/support/ports.ts";

// @spec APP-RUN-012, APP-RUN-016
// One app server on a temporary data folder and one page server in front of it, both started for
// the run. Neither may reuse a server already on its port, so a test never reaches real data.
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: `http://localhost:${E2E_PAGE_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node --no-warnings=ExperimentalWarning --import tsx tests/support/e2e-server.ts",
      url: `http://localhost:${E2E_API_PORT}/api/status`,
      env: { PORT: String(E2E_API_PORT), TRACKER_FAKE: "1" },
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: "pipe",
    },
    {
      command: `npx vite --port ${E2E_PAGE_PORT} --strictPort`,
      url: `http://localhost:${E2E_PAGE_PORT}`,
      env: { PORT: String(E2E_API_PORT) },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
