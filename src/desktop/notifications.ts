import type { NoticeHandle, NoticeTarget, NotificationsPort } from "./ports.ts";
import type { SettingsStore } from "./settings.ts";

/**
 * The desktop shell's notifications: a pending leg not yet seen in the run and a logged hop, both only
 * while the window is not in front; the server given up on, at once; backups failing and an update
 * ready, each once and only once the sim is out of use; and the pilot's first close of the window. The
 * shell writes only the titles and fixed sentences, the rest in the tracker's and server's own words.
 * Every notice is silent while the sim is in use and none is urgent. In test mode each is written to
 * desktop.log instead of shown.
 */

export interface PendingNotice {
  id: string;
  sim: { title: string; livery: string } | null;
  reason: string;
}

export interface NotifierOptions {
  mode: "installed" | "test";
  port: NotificationsPort;
  settings: SettingsStore;
  /** DESK-SHELL-AWAY-001 now. */
  simInUse(): boolean;
  windowForeground(): boolean;
  log(line: string): void;
}

interface Notice {
  title: string;
  body: string;
  target: NoticeTarget;
}

const GAVE_UP_ADVICE = "Choose Try again or Show log in the tray icon's menu.";
const FIRST_CLOSE =
  "MSFS Career Map keeps running and logs your flights. Quit it from the tray icon's menu, under ^ on the taskbar (Settings > Personalization > Taskbar > Other system tray icons keeps it in view).";

/** The sim aircraft (its livery when it has one) and the tracker's reason; the reason alone with no aircraft. */
function pendingBody(leg: PendingNotice): string {
  if (leg.sim === null) return leg.reason;
  const aircraft = leg.sim.livery === "" ? leg.sim.title : `${leg.sim.title} · ${leg.sim.livery}`;
  return `${aircraft}\n${leg.reason}`;
}

// @spec DESK-SHELL-NOTE-001, DESK-SHELL-NOTE-002, DESK-SHELL-NOTE-003, DESK-SHELL-NOTE-004, DESK-SHELL-NOTE-005, DESK-SHELL-NOTE-006, DESK-SHELL-NOTE-007, DESK-SHELL-NOTE-008, DESK-SHELL-NOTE-010, DESK-SHELL-NOTE-011, DESK-SHELL-NOTE-018, DESK-SHELL-NOTE-019, DESK-SHELL-AWAY-004, DESK-SHELL-TRAY-023
export class Notifier {
  private readonly o: NotifierOptions;
  /** Pending ids seen in this run, notified or not. */
  private readonly seen = new Set<string>();
  /** The notifications of pending legs still listed, by id. */
  private readonly pendingHandles = new Map<string, NoticeHandle>();
  private subscriptions = 0;
  /** At most one of each kind waiting for the sim to leave use. */
  private waitingBackups: Notice | null = null;
  private waitingUpdate: { notice: Notice; version: string } | null = null;

  constructor(o: NotifierOptions) {
    this.o = o;
  }

  /** A successful read at a subscription: the run's first marks every listed leg seen; later ones notify the unseen. */
  subscribed(pending: PendingNotice[]): void {
    const first = this.subscriptions++ === 0;
    for (const leg of pending) {
      if (first) this.seen.add(leg.id);
      else this.pendingEvent(leg);
    }
  }

  /** A `pending` event: notified once per run, only while the window is not in front; seen either way. */
  pendingEvent(leg: PendingNotice): void {
    if (this.seen.has(leg.id)) return;
    this.seen.add(leg.id);
    if (this.o.windowForeground()) return;
    const handle = this.show({ title: "Leg waiting to be logged", body: pendingBody(leg), target: { kind: "pending", id: leg.id } });
    if (handle) this.pendingHandles.set(leg.id, handle);
  }

  /** A `hop` event, while the window is not in front. */
  hopEvent(e: { id: number; message: string }): void {
    if (this.o.windowForeground()) return;
    this.show({ title: "Hop logged", body: e.message, target: { kind: "hop", id: e.id } });
  }

  /** The pending ids a status lists: the notification of a leg no longer listed is closed. */
  pendingListed(ids: string[]): void {
    const listed = new Set(ids);
    for (const [id, handle] of this.pendingHandles) {
      if (listed.has(id)) continue;
      handle.close();
      this.pendingHandles.delete(id);
    }
  }

  /** The server given up on: at once, whatever the window or the sim. */
  gaveUp(reason: string): void {
    this.show({ title: "MSFS Career Map stopped tracking", body: `${reason}\n${GAVE_UP_ADVICE}`, target: { kind: "failure" } });
  }

  /** Daily backups failing: once for the run of failures, once the sim is out of use. */
  backupsFailing(folder: string, short: string): void {
    if (this.o.settings.get().dailyBackupFailures.notified) return;
    this.waitingBackups = {
      title: "Backups are failing",
      body: `MSFS Career Map could not back up the logbook to ${folder}: ${short}.`,
      target: { kind: "window" },
    };
    this.recheck();
  }

  /** An update ready: once per version as the settings record it, once the sim is out of use. */
  updateReady(version: string): void {
    if (this.o.settings.get().updateNoticesShown.includes(version)) return;
    this.waitingUpdate = {
      version,
      notice: {
        title: "Update ready",
        body: `Version ${version} installs when you quit MSFS Career Map or choose Restart to update in the tray, or by itself once MSFS and the MSFS Career Map window are closed.`,
        target: { kind: "window" },
      },
    };
    this.recheck();
  }

  /** The pilot's first close of the window (the shell decides it qualifies): shown and recorded. */
  firstClose(): void {
    this.show({ title: "Still tracking in the tray", body: FIRST_CLOSE, target: { kind: "window" } });
    this.o.settings.update((s) => (s.trayNoticeShown = true));
  }

  /** The sim may have left use: the notices waiting for it are shown now. */
  recheck(): void {
    if (this.o.simInUse()) return;
    const backups = this.waitingBackups;
    if (backups) {
      this.waitingBackups = null;
      this.show(backups);
      this.o.settings.update((s) => (s.dailyBackupFailures = { ...s.dailyBackupFailures, notified: true }));
    }
    const update = this.waitingUpdate;
    if (update) {
      this.waitingUpdate = null;
      if (!this.o.settings.get().updateNoticesShown.includes(update.version)) {
        this.show(update.notice);
        this.o.settings.update((s) => (s.updateNoticesShown = [...s.updateNoticesShown, update.version]));
      }
    }
  }

  /** Shown (silent while the sim is in use), or in test mode written to the log; the handle, or null in test mode. */
  private show(n: Notice): NoticeHandle | null {
    if (this.o.mode === "test") {
      this.o.log(`[notification] ${n.title}: ${n.body.replace(/\n/g, " · ")}`);
      return null;
    }
    return this.o.port.show({ ...n, silent: this.o.simInUse() });
  }
}
