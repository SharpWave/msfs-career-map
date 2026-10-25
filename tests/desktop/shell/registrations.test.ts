/**
 * `--unregister` and the notification registrations (src/desktop/unregister.ts; m5a contract §4.3): a
 * start outside test mode removes them and clears the app's notifications (DESK-SHELL-NOTE-017, the
 * notification half of DESK-SHELL-CLI-009), its outcome in desktop.log and its exit code still the start
 * lists' alone; a start in test mode touches none of them (NOTE-016).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runUnregister } from "../../../src/desktop/unregister.ts";
import { FakeClock } from "../support/clock.ts";
import { FakeKeys, FakeRegistrations, ScriptedFs, installedPlan, tempFolder, testPlan } from "../support/fakes.ts";
import { Sims, TEST_PROGRAM, fixture } from "../start-lists/support/sims.ts";

const win = path.win32;
const STAMPED = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z (.*)$/;
const PROGRAMS = { program: TEST_PROGRAM, earlier: [] as string[] };

function logLines(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l !== "")
    .map((l) => STAMPED.exec(l)?.[1] ?? l);
}

function installed() {
  const sims = new Sims();
  const plan = installedPlan(sims.root);
  const registrations = new FakeRegistrations();
  const keys = new FakeKeys();
  return {
    sims,
    keys,
    registrations,
    log: () => logLines(win.join(plan.electronFolder, "logs", "desktop.log")),
    run: () => runUnregister({ plan, env: sims.env, clock: new FakeClock(), fs: new ScriptedFs(), keys, registrations, programs: PROGRAMS }),
  };
}

describe("--unregister and the notification registrations", () => {
  // @spec DESK-SHELL-NOTE-017, DESK-SHELL-CLI-009
  it("removes them outside test mode and logs it, the exit code still 0 with nothing left in either start list", async () => {
    const h = installed();
    expect(await h.run()).toBe(0);
    expect(h.registrations.removed).toBe(1);
    expect(h.registrations.registered).toBe(0);
    expect(h.log()).toContain("[unregister] notification registrations removed");
  });

  // @spec DESK-SHELL-NOTE-017, DESK-SHELL-CLI-009
  it("logs what could not be removed, leaving the exit code to the start lists", async () => {
    const h = installed();
    h.registrations.problems = ["reg delete HKCU\\Software\\Classes\\CLSID\\{x}: Access is denied", "the notification centre could not be cleared"];
    expect(await h.run()).toBe(0);
    expect(h.log()).toContain(
      "[unregister] notification registrations could not be removed: reg delete HKCU\\Software\\Classes\\CLSID\\{x}: Access is denied; the notification centre could not be cleared",
    );
  });

  // @spec DESK-SHELL-NOTE-017, DESK-SHELL-CLI-009
  it("removes them when a start list still holds the app's entry, the code then naming that list alone", async () => {
    const h = installed();
    h.sims.install("Store").put("Store", fixture("malformed.xml"));
    h.keys.fail.remove = "Access is denied";
    h.keys.run = `"${TEST_PROGRAM}" --background`;
    expect(await h.run()).toBe(3);
    expect(h.registrations.removed).toBe(1);
  });

  // @spec DESK-SHELL-NOTE-016, DESK-SHELL-CLI-009
  it("in test mode neither registers nor removes anything", async () => {
    const folder = tempFolder("unregister-test-");
    const registrations = new FakeRegistrations();
    const keys = new FakeKeys();
    const code = await runUnregister({ plan: testPlan(folder), env: new Sims().env, clock: new FakeClock(), fs: new ScriptedFs(), keys, registrations, programs: PROGRAMS });
    expect(code).toBe(0);
    expect(registrations.removed).toBe(0);
    expect(registrations.registered).toBe(0);
    expect(keys.calls).toEqual([]);
  });
});
