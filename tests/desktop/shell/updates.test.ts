/**
 * The updates' own logic (src/desktop/updates.ts; m5b contract §3, §4.1): the checks — 1 minute after
 * start, every 4 hours, and on Check for updates — skipped while a download runs, an update is ready or
 * the shell is quitting (DESK-SHELL-UPD-003); the version line's words for each state (TRAY-016,
 * UPD-004, UPD-022..027); downloads only with the sim not in use, an update found meanwhile waiting for it
 * and a download already running finishing (UPD-006, UPD-007); a failed download discarded and tried again
 * at the next check (UPD-008); an update ready, from a download or one already downloaded (UPD-009); a
 * check that fell due during sleep run at resume (SRV-039); entering the quitting state cancelling a check
 * or download (QUIT-002); the backup before an update failing and its hour (UPD-016); an installer that
 * could not be started (UPD-019); and the quiet moment's 5 unbroken minutes (UPD-028).
 */
import { describe, expect, it } from "vitest";
import type { CheckResult } from "../../../src/desktop/ports.ts";
import { QuietMoment, Updates, versionLine, type UpdateState } from "../../../src/desktop/updates.ts";
import { FakeClock } from "../support/clock.ts";
import { FakeUpdater } from "../support/fakes.ts";
import { takeGuardHits } from "../support/guard.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const Y = "0.9.0";
const FOUND: CheckResult = { kind: "found", version: Y, downloaded: false };

interface Harness {
  clock: FakeClock;
  updater: FakeUpdater;
  updates: Updates;
  sim: { inUse: boolean };
  quitting: { now: boolean };
  changes: number;
  readyCalls: string[];
  lines: string[];
  line(): string;
}

function harness(o: { initial?: UpdateState; simInUse?: boolean } = {}): Harness {
  const clock = new FakeClock();
  const updater = new FakeUpdater();
  const sim = { inUse: o.simInUse ?? false };
  const quitting = { now: false };
  const h = {
    clock,
    updater,
    sim,
    quitting,
    changes: 0,
    readyCalls: [] as string[],
    lines: [] as string[],
  } as Harness;
  h.updates = new Updates({
    clock,
    updater,
    version: "0.8.0",
    initial: o.initial ?? { kind: "idle" },
    simInUse: () => sim.inUse,
    quitting: () => quitting.now,
    changed: () => h.changes++,
    becameReady: (v) => h.readyCalls.push(v),
    log: (line) => h.lines.push(line),
  });
  h.line = () => versionLine("0.8.0", h.updates.state());
  return h;
}

/** The checks asked of the updater so far. */
const checks = (u: FakeUpdater): number => u.calls.filter((c) => c === "check").length;
const downloadsOf = (u: FakeUpdater): string[] => u.calls.filter((c) => c.startsWith("download "));

/** Start, the first check at 1 min, answered with `r`. */
async function firstCheck(h: Harness, r: CheckResult): Promise<void> {
  h.updates.start();
  await h.clock.advance(MINUTE);
  h.updater.answerCheck(r);
  await h.clock.advance(0);
}

/** A first check that finds Y and downloads it to ready. */
async function readyHarness(o: { simInUse?: boolean } = {}): Promise<Harness> {
  const h = harness(o);
  await firstCheck(h, { kind: "found", version: Y, downloaded: false });
  h.updater.downloads.at(-1)!.finish();
  await h.clock.advance(0);
  expect(h.updates.state()).toEqual({ kind: "ready", version: Y, backupFailed: null });
  return h;
}

describe("loading the module", () => {
  // @spec DESK-SHELL-TEST-001
  it("reaches no process, port or Electron", () => {
    expect(takeGuardHits()).toEqual([]);
  });
});

describe("the version line", () => {
  // @spec DESK-SHELL-TRAY-016, DESK-SHELL-UPD-004, DESK-SHELL-UPD-022, DESK-SHELL-UPD-023, DESK-SHELL-UPD-024, DESK-SHELL-UPD-025, DESK-SHELL-UPD-027, DESK-SHELL-UPD-016, DESK-SHELL-UPD-019, DESK-SHELL-UPD-020, DESK-SHELL-UPD-008, DESK-SHELL-UPD-009
  it("reads the running version with each update state, in TRAY-016's words", () => {
    const cases: [UpdateState, string][] = [
      [{ kind: "idle" }, "Version 0.8.0"],
      [{ kind: "failed-at-start", version: Y }, "Version 0.8.0 — 0.9.0 could not be installed"],
      [{ kind: "checking" }, "Version 0.8.0 — checking for updates"],
      [{ kind: "up-to-date" }, "Version 0.8.0 — up to date"],
      [{ kind: "check-failed" }, "Version 0.8.0 — update check failed"],
      [{ kind: "found", version: Y }, "Version 0.8.0 — 0.9.0 found; downloads when the sim is not in use"],
      [{ kind: "downloading", version: Y }, "Version 0.8.0 — downloading 0.9.0"],
      [{ kind: "download-failed", version: Y }, "Version 0.8.0 — download of 0.9.0 failed"],
      [{ kind: "ready", version: Y, backupFailed: null }, "Version 0.8.0 — 0.9.0 ready"],
      [{ kind: "ready", version: Y, backupFailed: "disk full" }, "Version 0.8.0 — 0.9.0 waiting: backup failed (disk full)"],
      [{ kind: "could-not-install", version: Y }, "Version 0.8.0 — 0.9.0 could not be installed"],
    ];
    for (const [state, line] of cases) expect(versionLine("0.8.0", state)).toBe(line);
  });

  // @spec DESK-SHELL-UPD-025, DESK-SHELL-UPD-020
  it("begins in the state given: Version X alone, or Y could not be installed when this start found an installer that failed", () => {
    expect(harness().line()).toBe("Version 0.8.0");
    expect(harness({ initial: { kind: "failed-at-start", version: Y } }).line()).toBe("Version 0.8.0 — 0.9.0 could not be installed");
  });
});

describe("the checks", () => {
  // @spec DESK-SHELL-UPD-003, DESK-SHELL-UPD-004, DESK-SHELL-UPD-022
  it("checks 1 minute after start, reading checking for updates and then up to date", async () => {
    const h = harness();
    h.updates.start();
    await h.clock.advance(MINUTE - 1);
    expect(checks(h.updater)).toBe(0);
    await h.clock.advance(1);
    expect(checks(h.updater)).toBe(1);
    expect(h.line()).toBe("Version 0.8.0 — checking for updates");
    expect(h.changes).toBeGreaterThan(0);
    h.updater.answerCheck({ kind: "none" });
    await h.clock.advance(0);
    expect(h.updates.state()).toEqual({ kind: "up-to-date" });
    expect(h.line()).toBe("Version 0.8.0 — up to date");
  });

  // @spec DESK-SHELL-UPD-003
  it("checks again every 4 hours after the first", async () => {
    const h = harness();
    await firstCheck(h, { kind: "none" });
    await h.clock.advance(4 * HOUR - 1);
    expect(checks(h.updater)).toBe(1);
    await h.clock.advance(1);
    expect(checks(h.updater)).toBe(2);
    h.updater.answerCheck({ kind: "none" });
    await h.clock.advance(4 * HOUR);
    expect(checks(h.updater)).toBe(3);
  });

  // @spec DESK-SHELL-UPD-003
  it("checks at once on Check for updates, before the first check falls due", async () => {
    const h = harness();
    h.updates.start();
    h.updates.checkNow();
    await h.clock.advance(0);
    expect(checks(h.updater)).toBe(1);
    expect(h.line()).toBe("Version 0.8.0 — checking for updates");
  });

  // @spec DESK-SHELL-UPD-023
  it("reads update check failed when a check fails, the reason in desktop.log", async () => {
    const h = harness();
    await firstCheck(h, { kind: "failed", reason: "getaddrinfo ENOTFOUND api.github.com" });
    expect(h.updates.state()).toEqual({ kind: "check-failed" });
    expect(h.line()).toBe("Version 0.8.0 — update check failed");
    expect(h.lines.some((l) => l.includes("getaddrinfo ENOTFOUND api.github.com"))).toBe(true);
  });

  // @spec DESK-SHELL-UPD-003, DESK-SHELL-UPD-024
  it("skips a check that falls due or is chosen while a download runs, the line still reading downloading Y", async () => {
    const h = harness();
    await firstCheck(h, FOUND);
    expect(h.updates.state()).toEqual({ kind: "downloading", version: Y });
    h.updates.checkNow();
    await h.clock.advance(4 * HOUR);
    expect(checks(h.updater)).toBe(1);
    expect(h.line()).toBe("Version 0.8.0 — downloading 0.9.0");
  });

  // @spec DESK-SHELL-UPD-003, DESK-SHELL-UPD-009
  it("skips every check while an update is ready, the line still reading Y ready", async () => {
    const h = await readyHarness();
    h.updates.checkNow();
    await h.clock.advance(8 * HOUR);
    expect(checks(h.updater)).toBe(1);
    expect(h.line()).toBe("Version 0.8.0 — 0.9.0 ready");
  });

  // @spec DESK-SHELL-UPD-003, DESK-SHELL-UPD-016
  it("skips every check while an update waits after a failed backup, the line still reading waiting: backup failed", async () => {
    const h = await readyHarness();
    h.updates.backupFailed(Y, "disk full");
    h.updates.checkNow();
    await h.clock.advance(4 * HOUR);
    expect(checks(h.updater)).toBe(1);
    expect(h.line()).toBe("Version 0.8.0 — 0.9.0 waiting: backup failed (disk full)");
  });

  // @spec DESK-SHELL-UPD-003, DESK-SHELL-QUIT-004
  it("skips every check while the shell is quitting", async () => {
    const h = harness();
    h.updates.start();
    h.quitting.now = true;
    h.updates.checkNow();
    await h.clock.advance(MINUTE);
    expect(checks(h.updater)).toBe(0);
  });

  // @spec DESK-SHELL-UPD-026
  it("replaces whatever the line read — download of Y failed, Y found, could not be installed — with checking and then what it finds", async () => {
    // From a failed download.
    const h = harness();
    await firstCheck(h, FOUND);
    h.updater.downloads.at(-1)!.finish({ ok: false, reason: "ECONNRESET" });
    await h.clock.advance(0);
    expect(h.line()).toBe("Version 0.8.0 — download of 0.9.0 failed");
    h.updates.checkNow();
    await h.clock.advance(0);
    expect(h.line()).toBe("Version 0.8.0 — checking for updates");
    h.updater.answerCheck({ kind: "none" });
    await h.clock.advance(0);
    expect(h.line()).toBe("Version 0.8.0 — up to date");

    // From an installer that failed at the last start.
    const f = harness({ initial: { kind: "failed-at-start", version: Y } });
    await firstCheck(f, { kind: "found", version: Y, downloaded: false });
    expect(f.line()).toBe("Version 0.8.0 — downloading 0.9.0");

    // From an update found that waits for the sim.
    const w = harness({ simInUse: true });
    await firstCheck(w, FOUND);
    expect(w.line()).toBe("Version 0.8.0 — 0.9.0 found; downloads when the sim is not in use");
    w.updates.checkNow();
    await w.clock.advance(0);
    expect(w.line()).toBe("Version 0.8.0 — checking for updates");
  });
});

describe("downloading", () => {
  // @spec DESK-SHELL-UPD-006, DESK-SHELL-UPD-024, DESK-SHELL-UPD-009, DESK-SHELL-NOTE-003
  it("downloads an update found with the sim not in use, and counts it ready once the download is done", async () => {
    const h = harness();
    await firstCheck(h, FOUND);
    expect(downloadsOf(h.updater)).toEqual([`download ${Y}`]);
    expect(h.line()).toBe("Version 0.8.0 — downloading 0.9.0");
    expect(h.updates.ready()).toBeNull();
    h.updater.downloads.at(-1)!.finish();
    await h.clock.advance(0);
    expect(h.updates.state()).toEqual({ kind: "ready", version: Y, backupFailed: null });
    expect(h.updates.ready()).toBe(Y);
    expect(h.line()).toBe("Version 0.8.0 — 0.9.0 ready");
    expect(h.readyCalls).toEqual([Y]);
  });

  // @spec DESK-SHELL-UPD-006, DESK-SHELL-UPD-007, DESK-SHELL-UPD-027
  it("waits with an update found while the sim is in use, and downloads it once the sim is no longer in use", async () => {
    const h = harness({ simInUse: true });
    await firstCheck(h, FOUND);
    expect(downloadsOf(h.updater)).toEqual([]);
    expect(h.updates.state()).toEqual({ kind: "found", version: Y });
    expect(h.line()).toBe("Version 0.8.0 — 0.9.0 found; downloads when the sim is not in use");

    h.updates.recheck();
    await h.clock.advance(0);
    expect(downloadsOf(h.updater)).toEqual([]);

    h.sim.inUse = false;
    h.updates.recheck();
    await h.clock.advance(0);
    expect(downloadsOf(h.updater)).toEqual([`download ${Y}`]);
    expect(h.line()).toBe("Version 0.8.0 — downloading 0.9.0");
  });

  // @spec DESK-SHELL-UPD-007
  it("lets a download already running finish when the sim comes into use", async () => {
    const h = harness();
    await firstCheck(h, FOUND);
    h.sim.inUse = true;
    h.updates.recheck();
    await h.clock.advance(0);
    expect(h.updater.downloads.at(-1)!.cancelled).toBe(false);
    expect(h.line()).toBe("Version 0.8.0 — downloading 0.9.0");
    h.updater.downloads.at(-1)!.finish();
    await h.clock.advance(0);
    expect(h.updates.ready()).toBe(Y);
  });

  // @spec DESK-SHELL-UPD-008
  it("discards a failed download, logs it, reads download of Y failed, and tries again at the next check with the sim not in use", async () => {
    const h = harness();
    await firstCheck(h, FOUND);
    h.updater.downloads.at(-1)!.finish({ ok: false, reason: "sha512 checksum mismatch" });
    await h.clock.advance(0);
    expect(h.updater.calls).toContain("discard");
    expect(h.updates.state()).toEqual({ kind: "download-failed", version: Y });
    expect(h.lines.some((l) => l.includes("sha512 checksum mismatch"))).toBe(true);
    expect(h.updates.ready()).toBeNull();

    // The next check, the sim now in use: found and waiting, no download.
    h.sim.inUse = true;
    h.updates.checkNow();
    await h.clock.advance(0);
    h.updater.answerCheck(FOUND);
    await h.clock.advance(0);
    expect(downloadsOf(h.updater)).toEqual([`download ${Y}`]);
    expect(h.updates.state()).toEqual({ kind: "found", version: Y });

    // The sim leaves use: the download starts again.
    h.sim.inUse = false;
    h.updates.recheck();
    await h.clock.advance(0);
    expect(downloadsOf(h.updater)).toEqual([`download ${Y}`, `download ${Y}`]);
  });

  // @spec DESK-SHELL-UPD-009, DESK-SHELL-UPD-026
  it("counts an update already downloaded in an earlier run ready at the check, even with the sim in use", async () => {
    const h = harness({ simInUse: true });
    await firstCheck(h, { kind: "found", version: Y, downloaded: true });
    // The download only validates the cached installer.
    expect(downloadsOf(h.updater)).toEqual([`download ${Y}`]);
    h.updater.downloads.at(-1)!.finish();
    await h.clock.advance(0);
    expect(h.updates.state()).toEqual({ kind: "ready", version: Y, backupFailed: null });
    expect(h.line()).toBe("Version 0.8.0 — 0.9.0 ready");
    expect(h.readyCalls).toEqual([Y]);
  });

  // @spec DESK-SHELL-UPD-009, DESK-SHELL-NOTE-003
  it("reports a version ready once in the run, though it becomes ready again after its installer could not be started", async () => {
    const h = await readyHarness();
    await h.updates.installFailed(Y);
    h.updates.checkNow();
    await h.clock.advance(0);
    h.updater.answerCheck(FOUND);
    await h.clock.advance(0);
    h.updater.downloads.at(-1)!.finish();
    await h.clock.advance(0);
    expect(h.updates.ready()).toBe(Y);
    expect(h.readyCalls).toEqual([Y]);
  });
});

describe("sleep and the quitting state", () => {
  // @spec DESK-SHELL-SRV-039
  it("runs at resume a check that fell due while the PC slept, and nothing when none did", async () => {
    const h = harness();
    await firstCheck(h, { kind: "none" });
    // An hour of sleep: nothing due.
    h.clock.setWall(new Date(h.clock.wallNow().getTime() + HOUR));
    h.updates.resume();
    await h.clock.advance(0);
    expect(checks(h.updater)).toBe(1);
    // Five hours of sleep: the 4-hour check fell due.
    h.clock.setWall(new Date(h.clock.wallNow().getTime() + 4 * HOUR));
    h.updates.resume();
    await h.clock.advance(0);
    expect(checks(h.updater)).toBe(2);
    expect(h.line()).toBe("Version 0.8.0 — checking for updates");
  });

  // @spec DESK-SHELL-QUIT-002
  it("cancels a check under way on entering the quitting state, the line going back to what it read", async () => {
    const h = harness();
    await firstCheck(h, { kind: "none" });
    h.updates.checkNow();
    await h.clock.advance(0);
    expect(h.line()).toBe("Version 0.8.0 — checking for updates");
    h.quitting.now = true;
    h.updates.enterQuitting();
    await h.clock.advance(0);
    expect(h.updater.calls).toContain("cancelCheck");
    expect(h.line()).toBe("Version 0.8.0 — up to date");
  });

  // @spec DESK-SHELL-QUIT-002, DESK-SHELL-QUIT-009
  it("cancels a download under way on entering the quitting state, and downloads again once it has left it", async () => {
    const h = harness();
    await firstCheck(h, FOUND);
    h.quitting.now = true;
    h.updates.enterQuitting();
    await h.clock.advance(0);
    expect(h.updater.downloads[0].cancelled).toBe(true);
    expect(h.updates.state()).toEqual({ kind: "found", version: Y });
    expect(h.updates.ready()).toBeNull();

    h.quitting.now = false;
    h.updates.leaveQuitting();
    await h.clock.advance(0);
    expect(downloadsOf(h.updater)).toEqual([`download ${Y}`, `download ${Y}`]);
    expect(h.line()).toBe("Version 0.8.0 — downloading 0.9.0");
  });

  // @spec DESK-SHELL-QUIT-004, DESK-SHELL-QUIT-009, DESK-SHELL-UPD-003
  it("starts no check while quitting, and checks again 4 hours after the last once it has left the state", async () => {
    const h = harness();
    await firstCheck(h, { kind: "none" });
    await h.clock.advance(HOUR);
    h.quitting.now = true;
    h.updates.enterQuitting();
    await h.clock.advance(4 * HOUR);
    expect(checks(h.updater)).toBe(1);
    h.quitting.now = false;
    h.updates.leaveQuitting();
    // The last check started at 1 min; 5 h have passed since: the next is due now.
    await h.clock.advance(0);
    expect(checks(h.updater)).toBe(2);
  });
});

describe("the backup before an update and the installer", () => {
  // @spec DESK-SHELL-UPD-016, DESK-SHELL-UPD-028
  it("keeps the update ready with the backup's short reason, and counts the failure for an hour by the wall clock", async () => {
    const h = await readyHarness();
    expect(h.updates.backupFailedWithinHour()).toBe(false);
    h.updates.backupFailed(Y, "Windows refused the write");
    expect(h.updates.state()).toEqual({ kind: "ready", version: Y, backupFailed: "Windows refused the write" });
    expect(h.updates.ready()).toBe(Y);
    expect(h.line()).toBe("Version 0.8.0 — 0.9.0 waiting: backup failed (Windows refused the write)");
    expect(h.updates.backupFailedWithinHour()).toBe(true);
    await h.clock.advance(HOUR - MINUTE);
    expect(h.updates.backupFailedWithinHour()).toBe(true);
    await h.clock.advance(2 * MINUTE);
    expect(h.updates.backupFailedWithinHour()).toBe(false);
  });

  // @spec DESK-SHELL-UPD-016
  it("clears the failed backup's reason once a backup before an update is done", async () => {
    const h = await readyHarness();
    h.updates.backupFailed(Y, "disk full");
    h.updates.backupDone();
    expect(h.updates.state()).toEqual({ kind: "ready", version: Y, backupFailed: null });
    expect(h.line()).toBe("Version 0.8.0 — 0.9.0 ready");
  });

  // @spec DESK-SHELL-UPD-019
  it("discards the download when its installer could not be started, reads Y could not be installed, and checks again", async () => {
    const h = await readyHarness();
    await h.updates.installFailed(Y);
    expect(h.updater.calls).toContain("discard");
    expect(h.updates.state()).toEqual({ kind: "could-not-install", version: Y });
    expect(h.updates.ready()).toBeNull();
    expect(h.line()).toBe("Version 0.8.0 — 0.9.0 could not be installed");
    h.updates.checkNow();
    await h.clock.advance(0);
    expect(checks(h.updater)).toBe(2);
  });
});

describe("the quiet moment", () => {
  /** A QuietMoment whose conditions are `cond.now`, counting its fires. */
  function quiet(): { clock: FakeClock; q: QuietMoment; cond: { now: boolean }; fired: () => number } {
    const clock = new FakeClock();
    const cond = { now: false };
    let fires = 0;
    const q = new QuietMoment({ clock, conditions: () => cond.now, fire: () => fires++ });
    return { clock, q, cond, fired: () => fires };
  }

  // @spec DESK-SHELL-UPD-028
  it("fires once its conditions have held for 5 unbroken minutes", async () => {
    const t = quiet();
    t.cond.now = true;
    t.q.recheck();
    await t.clock.advance(5 * MINUTE - 1);
    expect(t.fired()).toBe(0);
    await t.clock.advance(1);
    expect(t.fired()).toBe(1);
  });

  // @spec DESK-SHELL-UPD-028
  it("starts the 5 minutes again after a condition stops holding", async () => {
    const t = quiet();
    t.cond.now = true;
    t.q.recheck();
    await t.clock.advance(4 * MINUTE);
    t.cond.now = false;
    t.q.recheck();
    await t.clock.advance(MINUTE);
    t.cond.now = true;
    t.q.recheck();
    await t.clock.advance(5 * MINUTE - 1);
    expect(t.fired()).toBe(0);
    await t.clock.advance(1);
    expect(t.fired()).toBe(1);
  });

  // @spec DESK-SHELL-UPD-028
  it("keeps the 5 minutes running across rechecks that find the conditions still holding", async () => {
    const t = quiet();
    t.cond.now = true;
    t.q.recheck();
    for (let i = 0; i < 4; i++) {
      await t.clock.advance(MINUTE);
      t.q.recheck();
    }
    await t.clock.advance(MINUTE);
    expect(t.fired()).toBe(1);
  });

  // @spec DESK-SHELL-UPD-028
  it("never fires while its conditions do not hold, nor after stop()", async () => {
    const t = quiet();
    t.q.recheck();
    await t.clock.advance(10 * MINUTE);
    expect(t.fired()).toBe(0);
    t.cond.now = true;
    t.q.recheck();
    await t.clock.advance(MINUTE);
    t.q.stop();
    await t.clock.advance(10 * MINUTE);
    expect(t.fired()).toBe(0);
  });
});
