import fs from "node:fs";
import { defineConfig } from "vitest/config";

/** The app's version, as vitest.config.ts defines it, for any desktop module a test imports. */
const version: string = JSON.parse(fs.readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;

// `npm run test:installer` (DESK-DIST-INCL-001): the NSIS include's steps, built into small test
// programs with electron-builder's own NSIS and run on temp folders. No setup guard — these tests
// run programs — and one file at a time, since they start and end processes.
export default defineConfig({
  define: { __MSFS_CAREER_MAP_VERSION__: JSON.stringify(version) },
  test: {
    include: ["tests/installer/**/*.test.ts"],
    environment: "node",
    pool: "forks",
    isolate: true,
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
