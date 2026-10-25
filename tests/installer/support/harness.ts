/**
 * Each include test on its own stand-in folders (DESK-DIST-INCL-001), and everything else left as it
 * was (DESK-DIST-INCL-002): before each test a snapshot of what lies outside the stand-ins and of the
 * data, backups and Electron stand-ins; after it, even when it failed, every process started inside
 * the stand-ins ended, the stand-ins compared and removed, and the outside compared.
 */
import { afterEach, beforeEach, expect } from "vitest";
import { type StandIns, cleanUp, endProcessesIn, leftAlone, outsideSnapshot, standIns } from "./nsis.ts";

/** Registers the hooks; call the returned function inside a test for that test's stand-ins. */
export function useStandIns(): () => StandIns {
  let s: StandIns | undefined;
  let outside = "";
  let alone = "";
  beforeEach(() => {
    outside = outsideSnapshot();
    s = standIns();
    alone = leftAlone(s);
  });
  afterEach(async () => {
    const current = s;
    s = undefined;
    if (!current) return;
    try {
      await endProcessesIn(current.root);
      expect(leftAlone(current), "the data, backups and Electron stand-ins are left alone").toBe(alone);
    } finally {
      await cleanUp(current);
    }
    expect(outsideSnapshot(), "nothing outside the stand-ins changed").toBe(outside);
  });
  return () => {
    if (!s) throw new Error("no stand-ins outside a test");
    return s;
  };
}
