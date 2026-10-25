/**
 * The daily backup (src/desktop/daily-backups.ts; m2 contract §10.2): due with no time kept, a time
 * later than now or more than 24 h before now (DESK-SHELL-BAK-001, DESK-SHELL-BAK-002), checked at
 * the first start-up done and every hour after on the monotonic clock while the 24 h are reckoned on
 * the wall clock from the times in the settings (DESK-SHELL-SRV-037); a done keeps its time and
 * clears the failures (DESK-SHELL-BAK-003); failures counted and retried at the next hourly check
 * after the first, then only after 24 h (DESK-SHELL-BAK-004); three in a row shown as failing
 * (DESK-SHELL-TRAY-026); a backup cut short by a requested restart asked again, not counted
 * (DESK-SHELL-SRV-043).
 */
import { describe, expect, it } from "vitest";
import { DailyBackups, dailyDue, retryAllowed } from "../../../src/desktop/daily-backups.ts";
import type { BackupKind, BackupOutcome } from "../../../src/desktop/backups.ts";
import { SettingsStore, type DesktopSettings } from "../../../src/desktop/settings.ts";
import { FakeClock, flush } from "../support/clock.ts";
import { tempFolder } from "../support/fakes.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = new Date("2026-10-25T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const NO_FAILURES = { count: 0, lastAttempt: null, short: null, notified: false };

interface Ask {
  kind: BackupKind;
  resolve(o: BackupOutcome): void;
}

/** A DailyBackups on a fresh settings file (prepared by `pre`), a FakeClock at 2026-10-25T12:00Z, and a backups stand-in whose requests the test answers. */
function setup(pre?: (s: DesktopSettings) => void) {
  const folder = tempFolder();
  const settings = new SettingsStore(folder, () => {});
  settings.load();
  if (pre) settings.update(pre);
  const clock = new FakeClock();
  const asks: Ask[] = [];
  const backups = {
    request: (kind: BackupKind) => new Promise<BackupOutcome>((resolve) => asks.push({ kind, resolve })),
  };
  let changes = 0;
  const daily = new DailyBackups({ clock, settings, backups, changed: () => changes++ });
  return { folder, settings, clock, asks, daily, changes: () => changes };
}

const failed = (short: string): BackupOutcome => ({ ok: false, why: "failed", short, reason: `the backup failed: ${short}` });

describe("dailyDue", () => {
  // @spec DESK-SHELL-BAK-001
  it("is due with no time kept, an unreadable time, or more than 24 h before now", () => {
    expect(dailyDue(null, NOW)).toBe(true);
    expect(dailyDue("not a time", NOW)).toBe(true);
    expect(dailyDue(ago(DAY + 1), NOW)).toBe(true);
    expect(dailyDue(ago(3 * DAY), NOW)).toBe(true);
  });

  // @spec DESK-SHELL-BAK-001
  it("is not due within 24 h of the time kept", () => {
    expect(dailyDue(ago(0), NOW)).toBe(false);
    expect(dailyDue(ago(HOUR), NOW)).toBe(false);
    expect(dailyDue(ago(23 * HOUR), NOW)).toBe(false);
    expect(dailyDue(ago(DAY - 1), NOW)).toBe(false);
    expect(dailyDue(ago(DAY), NOW)).toBe(false);
  });

  // @spec DESK-SHELL-BAK-002
  it("is due when the time kept is later than now", () => {
    expect(dailyDue("2026-10-25T12:00:01.000Z", NOW)).toBe(true);
    expect(dailyDue("2027-01-01T00:00:00.000Z", NOW)).toBe(true);
  });
});

describe("retryAllowed", () => {
  // @spec DESK-SHELL-BAK-004
  it("allows the first retry at once: none or one failure in a row", () => {
    expect(retryAllowed({ count: 0, lastAttempt: null }, NOW)).toBe(true);
    expect(retryAllowed({ count: 1, lastAttempt: ago(60_000) }, NOW)).toBe(true);
    expect(retryAllowed({ count: 1, lastAttempt: ago(0) }, NOW)).toBe(true);
  });

  // @spec DESK-SHELL-BAK-004
  it("after two or more failures in a row, allows one only at least 24 h after the last attempt", () => {
    expect(retryAllowed({ count: 2, lastAttempt: ago(60_000) }, NOW)).toBe(false);
    expect(retryAllowed({ count: 2, lastAttempt: ago(DAY - 1) }, NOW)).toBe(false);
    expect(retryAllowed({ count: 2, lastAttempt: ago(DAY) }, NOW)).toBe(true);
    expect(retryAllowed({ count: 3, lastAttempt: ago(23 * HOUR) }, NOW)).toBe(false);
    expect(retryAllowed({ count: 5, lastAttempt: ago(2 * DAY) }, NOW)).toBe(true);
  });

  // @spec DESK-SHELL-BAK-004, DESK-SHELL-BAK-002
  it("allows one when the last attempt is missing, unreadable or later than now", () => {
    expect(retryAllowed({ count: 3, lastAttempt: null }, NOW)).toBe(true);
    expect(retryAllowed({ count: 3, lastAttempt: "not a time" }, NOW)).toBe(true);
    expect(retryAllowed({ count: 3, lastAttempt: "2026-10-26T00:00:00.000Z" }, NOW)).toBe(true);
  });
});

describe("the daily backup checks", () => {
  // @spec DESK-SHELL-BAK-001, DESK-SHELL-BAK-003
  it("asks at the first start-up done when no time is kept, and keeps the answer's time in the settings file", async () => {
    const t = setup();
    t.daily.startupDone({ requested: false });
    await flush();
    expect(t.asks.map((a) => a.kind)).toEqual(["daily"]);
    await t.clock.advance(5_000);
    t.asks[0].resolve({ ok: true, file: "C:\\Backups\\career.db" });
    await flush();
    expect(t.settings.get().lastDailyBackup).toBe("2026-10-25T12:00:05.000Z");
    expect(t.settings.get().dailyBackupFailures).toEqual(NO_FAILURES);
    expect(t.changes()).toBeGreaterThan(0);
    const reread = new SettingsStore(t.folder, () => {});
    expect(reread.load().lastDailyBackup).toBe("2026-10-25T12:00:05.000Z");
  });

  // @spec DESK-SHELL-BAK-001, DESK-SHELL-SRV-037
  it("asks nothing within 24 h of the last one, then asks at the hourly check that finds it due", async () => {
    const t = setup((s) => {
      s.lastDailyBackup = "2026-10-24T12:30:00.000Z"; // 23.5 h before the start
    });
    t.daily.startupDone({ requested: false });
    await flush();
    expect(t.asks).toHaveLength(0);
    await t.clock.advance(HOUR - 1);
    expect(t.asks).toHaveLength(0);
    await t.clock.advance(1);
    expect(t.asks.map((a) => a.kind)).toEqual(["daily"]);
  });

  // @spec DESK-SHELL-BAK-002
  it("asks at once when the time kept is later than now", async () => {
    const t = setup((s) => {
      s.lastDailyBackup = "2026-11-01T00:00:00.000Z";
    });
    t.daily.startupDone({ requested: false });
    await flush();
    expect(t.asks.map((a) => a.kind)).toEqual(["daily"]);
  });

  // @spec DESK-SHELL-BAK-001
  it("asks one at a time: an outstanding request holds the hourly checks", async () => {
    const t = setup();
    t.daily.startupDone({ requested: false });
    await flush();
    await t.clock.advance(3 * HOUR);
    expect(t.asks).toHaveLength(1);
  });

  // @spec DESK-SHELL-BAK-001
  it("runs one hourly check from the first start-up done; a later done starts no check of its own", async () => {
    const t = setup((s) => {
      s.lastDailyBackup = "2026-10-25T12:00:00.000Z";
    });
    t.daily.startupDone({ requested: false });
    await flush();
    expect(t.asks).toHaveLength(0);
    t.settings.update((s: DesktopSettings) => {
      s.lastDailyBackup = null;
    });
    t.daily.startupDone({ requested: false });
    t.daily.startupDone({ requested: true }); // a requested restart with nothing cut short
    await flush();
    expect(t.asks).toHaveLength(0);
    await t.clock.advance(HOUR - 1);
    expect(t.asks).toHaveLength(0);
    await t.clock.advance(1);
    expect(t.asks).toHaveLength(1);
  });
});

describe("failed daily backups", () => {
  // @spec DESK-SHELL-BAK-004, DESK-SHELL-TRAY-026, DESK-SHELL-SRV-037
  it("counts each with its attempt time, retries at the next hourly check after the first, then only after 24 h", async () => {
    const t = setup();
    t.daily.startupDone({ requested: false });
    await flush();
    expect(t.asks).toHaveLength(1);

    // The first failure, answered 30 s after the attempt: the attempt's time is kept.
    await t.clock.advance(30_000);
    t.asks[0].resolve(failed("the disk is full"));
    await flush();
    expect(t.settings.get().dailyBackupFailures).toEqual({
      count: 1,
      lastAttempt: "2026-10-25T12:00:00.000Z",
      short: "the disk is full",
      notified: false,
    });
    expect(t.settings.get().lastDailyBackup).toBeNull();
    expect(t.daily.failing()).toBeNull();
    const changesAfterFirst = t.changes();
    expect(changesAfterFirst).toBeGreaterThan(0);

    // The next hourly check asks again.
    await t.clock.advance(HOUR - 30_000);
    expect(t.asks).toHaveLength(2);
    t.asks[1].resolve(failed("no access"));
    await flush();
    expect(t.settings.get().dailyBackupFailures).toEqual({
      count: 2,
      lastAttempt: "2026-10-25T13:00:00.000Z",
      short: "no access",
      notified: false,
    });
    expect(t.changes()).toBeGreaterThan(changesAfterFirst);
    expect(t.daily.failing()).toBeNull();

    // Then nothing until 24 h after that attempt (wall 2026-10-26T13:00Z, the 25th hourly check).
    await t.clock.advance(23 * HOUR);
    expect(t.asks).toHaveLength(2);
    await t.clock.advance(HOUR);
    expect(t.asks).toHaveLength(3);
    t.asks[2].resolve(failed("the backups folder is missing"));
    await flush();
    expect(t.settings.get().dailyBackupFailures).toEqual({
      count: 3,
      lastAttempt: "2026-10-26T13:00:00.000Z",
      short: "the backups folder is missing",
      notified: false,
    });
    // The short reason of the last failure in the run, not of the first.
    expect(t.daily.failing()).toBe("the backups folder is missing");

    // Again only 24 h later; a done then clears it all.
    await t.clock.advance(23 * HOUR);
    expect(t.asks).toHaveLength(3);
    await t.clock.advance(HOUR);
    expect(t.asks).toHaveLength(4);
    t.asks[3].resolve({ ok: true, file: "C:\\Backups\\career.db" });
    await flush();
    expect(t.settings.get().lastDailyBackup).toBe("2026-10-27T13:00:00.000Z");
    expect(t.settings.get().dailyBackupFailures).toEqual(NO_FAILURES);
    expect(t.daily.failing()).toBeNull();
  });

  // @spec DESK-SHELL-BAK-003, DESK-SHELL-TRAY-026
  it("shows failing from the settings of an earlier run, and a done clears the count and the notified record", async () => {
    const t = setup((s) => {
      s.lastDailyBackup = "2026-10-20T12:00:00.000Z";
      s.dailyBackupFailures = { count: 3, lastAttempt: "2026-10-23T12:00:00.000Z", short: "the disk is full", notified: true };
    });
    expect(t.daily.failing()).toBe("the disk is full");
    t.daily.startupDone({ requested: false });
    await flush();
    expect(t.asks).toHaveLength(1);
    t.asks[0].resolve({ ok: true, file: "C:\\Backups\\career.db" });
    await flush();
    expect(t.settings.get().dailyBackupFailures).toEqual(NO_FAILURES);
    expect(t.settings.get().lastDailyBackup).toBe("2026-10-25T12:00:00.000Z");
    expect(t.daily.failing()).toBeNull();
    const reread = new SettingsStore(t.folder, () => {}).load();
    expect(reread.dailyBackupFailures).toEqual(NO_FAILURES);
  });

  // @spec DESK-SHELL-TRAY-026
  it("is not failing with fewer than three in a row", () => {
    const t = setup((s) => {
      s.dailyBackupFailures = { count: 2, lastAttempt: "2026-10-25T11:00:00.000Z", short: "the disk is full", notified: false };
    });
    expect(t.daily.failing()).toBeNull();
  });

  // @spec DESK-SHELL-BAK-004
  it("counts nothing for no server or an abandoned backup, and asks again at the next hourly check", async () => {
    const t = setup();
    t.daily.startupDone({ requested: false });
    await flush();
    t.asks[0].resolve({ ok: false, why: "no-server" });
    await flush();
    expect(t.settings.get().dailyBackupFailures).toEqual(NO_FAILURES);
    expect(t.settings.get().lastDailyBackup).toBeNull();
    await t.clock.advance(HOUR);
    expect(t.asks).toHaveLength(2);
    t.asks[1].resolve({ ok: false, why: "abandoned" });
    await flush();
    expect(t.settings.get().dailyBackupFailures).toEqual(NO_FAILURES);
    expect(t.settings.get().lastDailyBackup).toBeNull();
  });
});

describe("a daily backup cut short by a requested restart", () => {
  // @spec DESK-SHELL-SRV-043, DESK-SHELL-BAK-004
  it("is counted neither as failed nor in the run of failures, and is asked again at the new server's done", async () => {
    const t = setup();
    t.daily.startupDone({ requested: false });
    await flush();
    t.asks[0].resolve({ ok: false, why: "cut-short" });
    await flush();
    expect(t.settings.get().dailyBackupFailures).toEqual(NO_FAILURES);
    expect(t.settings.get().lastDailyBackup).toBeNull();
    await t.clock.advance(10_000);
    t.daily.startupDone({ requested: true });
    await flush();
    expect(t.asks.map((a) => a.kind)).toEqual(["daily", "daily"]);
    t.asks[1].resolve({ ok: true, file: "C:\\Backups\\career.db" });
    await flush();
    expect(t.settings.get().lastDailyBackup).toBe("2026-10-25T12:00:10.000Z");
  });
});

describe("the two clocks", () => {
  // @spec DESK-SHELL-SRV-037, DESK-SHELL-BAK-001
  it("reckons due-ness on the wall clock, but only an hourly check on the monotonic clock asks", async () => {
    const t = setup((s) => {
      s.lastDailyBackup = "2026-10-25T11:00:00.000Z";
    });
    t.daily.startupDone({ requested: false });
    await flush();
    expect(t.asks).toHaveLength(0);
    t.clock.setWall("2026-10-27T12:00:00.000Z");
    await flush();
    expect(t.asks).toHaveLength(0);
    await t.clock.advance(HOUR - 1);
    expect(t.asks).toHaveLength(0);
    await t.clock.advance(1);
    expect(t.asks).toHaveLength(1);
  });

  // @spec DESK-SHELL-SRV-037, DESK-SHELL-BAK-001
  it("asks nothing after 30 monotonic hours while the wall clock says only an hour or two have passed", async () => {
    const t = setup((s) => {
      s.lastDailyBackup = "2026-10-25T11:00:00.000Z";
    });
    t.daily.startupDone({ requested: false });
    await flush();
    for (let i = 0; i < 30; i++) {
      await t.clock.advance(HOUR);
      t.clock.setWall("2026-10-25T12:00:00.000Z");
    }
    expect(t.asks).toHaveLength(0);
  });
});

describe("stop", () => {
  // @spec DESK-SHELL-BAK-001
  it("ends the checks and holds no wait", async () => {
    const t = setup((s) => {
      s.lastDailyBackup = "2026-10-25T12:00:00.000Z";
    });
    t.daily.startupDone({ requested: false });
    await flush();
    t.daily.stop();
    expect(t.clock.pending()).toBe(0);
    t.settings.update((s: DesktopSettings) => {
      s.lastDailyBackup = null;
    });
    await t.clock.advance(5 * HOUR);
    expect(t.asks).toHaveLength(0);
    t.daily.startupDone({ requested: true });
    await flush();
    expect(t.asks).toHaveLength(0);
  });

  // @spec DESK-SHELL-BAK-004
  it("leaves the settings as they are when an outstanding backup's outcome arrives after it", async () => {
    for (const outcome of [failed("the server stopped"), { ok: true, file: "C:\\Backups\\career.db" } as BackupOutcome]) {
      const t = setup();
      t.daily.startupDone({ requested: false });
      await flush();
      expect(t.asks).toHaveLength(1);
      t.daily.stop();
      expect(t.clock.pending()).toBe(0);
      const before = JSON.stringify(t.settings.get());
      const changesBefore = t.changes();
      t.asks[0].resolve(outcome);
      await flush();
      expect(JSON.stringify(t.settings.get())).toBe(before);
      expect(t.changes()).toBe(changesBefore);
    }
  });
});
