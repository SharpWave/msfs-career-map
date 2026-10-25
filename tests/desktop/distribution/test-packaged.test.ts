/**
 * `npm run test:packaged`'s own script (scripts/test-packaged.ts; m3 contract §6.1), its pure parts:
 * the plain message when port 3280 is held, naming `npm run desktop` as the likely holder
 * (DESK-DIST-SMOKE-012), and Electron's environment without `ELECTRON_RUN_AS_NODE`
 * (DESK-DIST-DEV-005). The port check itself listens on a port, which this project's guard refuses;
 * the smoke test's run exercises it. Importing the script must start nothing.
 */
import { describe, expect, it } from "vitest";
import { PORT_HELD_MESSAGE, packagedEnv } from "../../../scripts/test-packaged.ts";
import { takeGuardHits } from "../support/guard.ts";

describe("loading the script", () => {
  // @spec DESK-SHELL-TEST-001
  it("starts nothing: no port, process or Playwright", () => {
    expect(takeGuardHits()).toEqual([]);
  });
});

describe("a held port", () => {
  // @spec DESK-DIST-SMOKE-012
  it("is reported in plain words naming port 3280 and npm run desktop as the likely holder", () => {
    expect(PORT_HELD_MESSAGE).toContain("3280");
    expect(PORT_HELD_MESSAGE).toContain("npm run desktop");
  });
});

describe("Electron's environment", () => {
  // @spec DESK-DIST-DEV-005
  it("leaves ELECTRON_RUN_AS_NODE out, however it is written, and keeps the rest", () => {
    expect(packagedEnv({ PATH: "C:\\Windows", ELECTRON_RUN_AS_NODE: "1", Foo: "bar" })).toEqual({ PATH: "C:\\Windows", Foo: "bar" });
    expect(packagedEnv({ electron_run_as_node: "1", PATH: "x" })).toEqual({ PATH: "x" });
    expect(packagedEnv({ PATH: "x" })).toEqual({ PATH: "x" });
  });
});
