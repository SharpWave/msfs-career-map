import type { Cancel, CheckResult, Clock, UpdaterPort } from "./ports.ts";

/**
 * The updates outside test mode: the checks (1 minute after start, every 4 hours, Check for updates),
 * the downloads, which start only while the sim is not in use, the state the tray's version line reads,
 * and the quiet moment's 5 unbroken minutes. The installs themselves (Quit, Restart to update, a quiet
 * moment) are the shell's; this keeps what they leave behind.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const FIRST_CHECK_MS = MINUTE;
const CHECK_EVERY_MS = 4 * HOUR;
const QUIET_MS = 5 * MINUTE;

export type UpdateState =
  /** Before the run's first check. */
  | { kind: "idle" }
  /** This start found an installer that failed (UPD-020). */
  | { kind: "failed-at-start"; version: string }
  | { kind: "checking" }
  | { kind: "up-to-date" }
  | { kind: "check-failed" }
  /** Waiting for the sim to leave use (UPD-027). */
  | { kind: "found"; version: string }
  | { kind: "downloading"; version: string }
  | { kind: "download-failed"; version: string }
  /** backupFailed: the short reason the last backup before it failed (UPD-016). */
  | { kind: "ready"; version: string; backupFailed: string | null }
  | { kind: "could-not-install"; version: string };

/** The tray's version line. */
// @spec DESK-SHELL-TRAY-016, DESK-SHELL-UPD-004, DESK-SHELL-UPD-022, DESK-SHELL-UPD-023, DESK-SHELL-UPD-024, DESK-SHELL-UPD-025, DESK-SHELL-UPD-027
export function versionLine(running: string, s: UpdateState): string {
  const x = `Version ${running}`;
  switch (s.kind) {
    case "idle":
      return x;
    case "failed-at-start":
    case "could-not-install":
      return `${x} — ${s.version} could not be installed`;
    case "checking":
      return `${x} — checking for updates`;
    case "up-to-date":
      return `${x} — up to date`;
    case "check-failed":
      return `${x} — update check failed`;
    case "found":
      return `${x} — ${s.version} found; downloads when the sim is not in use`;
    case "downloading":
      return `${x} — downloading ${s.version}`;
    case "download-failed":
      return `${x} — download of ${s.version} failed`;
    case "ready":
      return s.backupFailed === null ? `${x} — ${s.version} ready` : `${x} — ${s.version} waiting: backup failed (${s.backupFailed})`;
  }
}

export interface UpdatesOptions {
  clock: Clock;
  updater: UpdaterPort;
  version: string;
  /** The state to begin in: idle, or failed-at-start (UPD-020). */
  initial: UpdateState;
  simInUse(): boolean;
  quitting(): boolean;
  /** Any state change (the tray is shown again). */
  changed(): void;
  /** An update became ready: once per version in the run. */
  becameReady(version: string): void;
  log(line: string): void;
}

interface Running {
  cancelled: boolean;
}

interface Download extends Running {
  version: string;
  cancel(): void;
}

interface Check extends Running {
  /** The state to go back to when the check is cancelled. */
  before: UpdateState;
}

export class Updates {
  private s: UpdateState;
  private timer: Cancel | null = null;
  /** When the next check falls due, on both clocks; null before start(). */
  private nextDue: { mono: number; wall: number } | null = null;
  private check: Check | null = null;
  private download: Download | null = null;
  private readonly readyVersions = new Set<string>();
  /** Wall-clock ms of the last backup before an update that failed, while it is the last such backup. */
  private backupFailedAt: number | null = null;

  constructor(private readonly o: UpdatesOptions) {
    this.s = o.initial;
  }

  /** The first check at 1 minute, then every 4 hours on the monotonic clock. */
  // @spec DESK-SHELL-UPD-001, DESK-SHELL-UPD-003
  start(): void {
    this.arm(FIRST_CHECK_MS);
  }

  /** Check for updates: a check now, skipped as one falling due would be; the schedule left as it runs. */
  // @spec DESK-SHELL-UPD-003
  checkNow(): void {
    if (this.o.quitting()) return;
    void this.runCheck();
  }

  /** The sim may have left use: a found update starts downloading. */
  // @spec DESK-SHELL-UPD-006, DESK-SHELL-UPD-007
  recheck(): void {
    if (this.s.kind === "found" && this.download === null && !this.o.quitting() && !this.o.simInUse()) {
      this.startDownload(this.s.version);
    }
  }

  /** After sleep: a check whose wall time passed runs now. */
  // @spec DESK-SHELL-SRV-039
  resume(): void {
    if (this.timer === null || this.nextDue === null) return;
    if (this.o.clock.wallNow().getTime() >= this.nextDue.wall) this.due();
  }

  /** A check or download under way cancelled and the timers stopped; the state reads as before them. */
  // @spec DESK-SHELL-QUIT-002, DESK-SHELL-QUIT-004
  enterQuitting(): void {
    this.timer?.();
    this.timer = null;
    const check = this.check;
    if (check !== null) {
      check.cancelled = true;
      this.check = null;
      this.o.updater.cancelCheck();
      this.set(check.before);
    }
    const download = this.download;
    if (download !== null) {
      download.cancelled = true;
      this.download = null;
      download.cancel();
      this.set({ kind: "found", version: download.version });
    }
  }

  /** The timers again (the next check 4 hours after the last, an overdue one at once), and a found update's download. */
  // @spec DESK-SHELL-QUIT-009
  leaveQuitting(): void {
    if (this.nextDue !== null) this.arm(Math.max(0, this.nextDue.mono - this.o.clock.now()));
    this.recheck();
  }

  state(): UpdateState {
    return this.s;
  }

  ready(): string | null {
    return this.s.kind === "ready" ? this.s.version : null;
  }

  /** The backup before installing `version` failed: the update waits, with the short reason. */
  // @spec DESK-SHELL-UPD-016
  backupFailed(version: string, short: string): void {
    this.backupFailedAt = this.o.clock.wallNow().getTime();
    if (this.s.kind === "ready" && this.s.version === version) this.set({ ...this.s, backupFailed: short });
  }

  backupDone(): void {
    this.backupFailedAt = null;
    if (this.s.kind === "ready" && this.s.backupFailed !== null) this.set({ ...this.s, backupFailed: null });
  }

  /** A backup before an update failed less than an hour ago, by the wall clock. */
  // @spec DESK-SHELL-UPD-028
  backupFailedWithinHour(): boolean {
    return this.backupFailedAt !== null && this.o.clock.wallNow().getTime() - this.backupFailedAt < HOUR;
  }

  /** The installer could not be started: the download discarded; later checks find it again. */
  // @spec DESK-SHELL-UPD-019
  async installFailed(version: string): Promise<void> {
    this.backupFailedAt = null;
    this.set({ kind: "could-not-install", version });
    await this.o.updater.discard();
  }

  private arm(ms: number): void {
    this.timer?.();
    this.nextDue = { mono: this.o.clock.now() + ms, wall: this.o.clock.wallNow().getTime() + ms };
    this.timer = this.o.clock.after(ms, () => {
      this.timer = null;
      this.due();
    });
  }

  /** A check falling due: run unless skipped, and the next 4 hours from now. */
  private due(): void {
    if (this.o.quitting()) return;
    this.arm(CHECK_EVERY_MS);
    void this.runCheck();
  }

  // @spec DESK-SHELL-UPD-003, DESK-SHELL-UPD-026
  private async runCheck(): Promise<void> {
    if (this.check !== null || this.download !== null || this.s.kind === "ready") return;
    const check: Check = { cancelled: false, before: this.s };
    this.check = check;
    this.set({ kind: "checking" });
    const r: CheckResult = await this.o.updater.check();
    if (check.cancelled) return;
    this.check = null;
    if (r.kind === "none") return this.set({ kind: "up-to-date" });
    if (r.kind === "failed") {
      this.o.log(`[update] check failed: ${r.reason}`);
      return this.set({ kind: "check-failed" });
    }
    // One already downloaded is only validated, so it goes ahead whatever the sim.
    if (r.downloaded || !this.o.simInUse()) return this.startDownload(r.version);
    this.set({ kind: "found", version: r.version });
  }

  // @spec DESK-SHELL-UPD-006, DESK-SHELL-UPD-008, DESK-SHELL-UPD-009
  private startDownload(version: string): void {
    const handle = this.o.updater.download(version);
    const download: Download = { cancelled: false, version, cancel: () => handle.cancel() };
    this.download = download;
    this.set({ kind: "downloading", version });
    void handle.done.then((r) => {
      if (download.cancelled) return;
      this.download = null;
      if (r.ok) {
        this.set({ kind: "ready", version, backupFailed: null });
        if (!this.readyVersions.has(version)) {
          this.readyVersions.add(version);
          this.o.becameReady(version);
        }
        return;
      }
      this.o.log(`[update] download of ${version} failed: ${r.reason}`);
      void this.o.updater.discard();
      this.set({ kind: "download-failed", version });
    });
  }

  private set(s: UpdateState): void {
    this.s = s;
    this.o.changed();
  }
}

/** The quiet moment's conditions held for 5 unbroken minutes. */
// @spec DESK-SHELL-UPD-028
export class QuietMoment {
  private timer: Cancel | null = null;

  constructor(private readonly o: { clock: Clock; conditions(): boolean; fire(): void }) {}

  /** The conditions read now: holding, the 5 minutes run on (or start); not, they stop. */
  recheck(): void {
    if (!this.o.conditions()) return this.stop();
    if (this.timer !== null) return;
    this.timer = this.o.clock.after(QUIET_MS, () => {
      this.timer = null;
      this.o.fire();
    });
  }

  stop(): void {
    this.timer?.();
    this.timer = null;
  }
}
