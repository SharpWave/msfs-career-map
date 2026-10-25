import type { BackupRequests } from "./backups.ts";
import type { Cancel, Clock } from "./ports.ts";
import type { SettingsStore } from "./settings.ts";
import { TIMING } from "./timing.ts";

/**
 * The daily backup: checked at the run's first start-up done and every hour after on the monotonic
 * clock, while the 24 h are reckoned on the wall clock from the times kept in the settings.
 */

/** The time a settings string names, in ms; null when it is missing or unreadable. */
function timeOf(iso: string | null): number | null {
  if (iso === null) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** No time, an unreadable time, a time later than now, or more than 24 h before now. */
// @spec DESK-SHELL-BAK-001, DESK-SHELL-BAK-002
export function dailyDue(lastDailyBackup: string | null, now: Date): boolean {
  const t = timeOf(lastDailyBackup);
  return t === null || t > now.getTime() || now.getTime() - t > TIMING.dayMs;
}

/** count 0 or 1; or lastAttempt null, unreadable or later than now; or at least 24 h before now. */
// @spec DESK-SHELL-BAK-004
export function retryAllowed(f: { count: number; lastAttempt: string | null }, now: Date): boolean {
  if (f.count <= 1) return true;
  const t = timeOf(f.lastAttempt);
  return t === null || t > now.getTime() || now.getTime() - t >= TIMING.dayMs;
}

export interface DailyBackupsOptions {
  clock: Clock;
  settings: SettingsStore;
  backups: Pick<BackupRequests, "request">;
  changed(): void;
}

// @spec DESK-SHELL-BAK-001, DESK-SHELL-BAK-003, DESK-SHELL-BAK-004, DESK-SHELL-SRV-037, DESK-SHELL-SRV-043, DESK-SHELL-TRAY-026
export class DailyBackups {
  private readonly o: DailyBackupsOptions;
  private hourly: Cancel | null = null;
  private started = false;
  private stopped = false;
  private outstanding = false;
  /** The last daily backup was cut short by a requested restart: the next requested done asks again. */
  private cutShort = false;

  constructor(o: DailyBackupsOptions) {
    this.o = o;
  }

  /** The Supervisor's onStartupDone. The first call checks now and then every hour; requested with a cut-short daily backup checks again now. */
  startupDone(e: { requested: boolean }): void {
    if (this.stopped) return;
    if (!this.started) {
      this.started = true;
      this.arm();
      this.check();
    } else if (e.requested && this.cutShort) {
      this.cutShort = false;
      this.check();
    }
  }

  /** No check from now on. */
  stop(): void {
    this.stopped = true;
    this.hourly?.();
    this.hourly = null;
  }

  /** The short reason while 3 or more daily backups in a row have failed; else null. */
  failing(): string | null {
    const f = this.o.settings.get().dailyBackupFailures;
    return f.count >= 3 ? (f.short ?? "no reason given") : null;
  }

  private arm(): void {
    this.hourly = this.o.clock.after(TIMING.dailyCheckEveryMs, () => {
      this.arm();
      this.check();
    });
  }

  private check(): void {
    if (this.stopped || this.outstanding) return;
    const now = this.o.clock.wallNow();
    const s = this.o.settings.get();
    if (!dailyDue(s.lastDailyBackup, now) || !retryAllowed(s.dailyBackupFailures, now)) return;
    const attempt = now.toISOString();
    this.outstanding = true;
    void this.o.backups.request("daily").then((outcome) => {
      this.outstanding = false;
      if (this.stopped) return;
      if (outcome.ok) {
        const done = this.o.clock.wallNow().toISOString();
        this.o.settings.update((s) => {
          s.lastDailyBackup = done;
          s.dailyBackupFailures = { count: 0, lastAttempt: null, short: null, notified: false };
        });
        this.o.changed();
      } else if (outcome.why === "failed") {
        this.o.settings.update((s) => {
          const f = s.dailyBackupFailures;
          s.dailyBackupFailures = { count: f.count + 1, lastAttempt: attempt, short: outcome.short, notified: f.notified };
        });
        this.o.changed();
      } else if (outcome.why === "cut-short") {
        this.cutShort = true;
      }
    });
  }
}
