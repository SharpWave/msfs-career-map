import type { StartListItems } from "./start-lists.ts";
import type { ServerState } from "./supervisor.ts";
import type { TrayTracker } from "./tracker-feed.ts";

/**
 * What the tray shows: the status line (the shell's own states first, then the last tracker status
 * received), the tooltip, the icon's dot and the menu. Plain functions of the shell's state; the
 * glue turns the model into Electron's tray.
 */

export type TrayDot = "none" | "red" | "blue" | "violet" | "amber" | "green";
export type TrayItemId =
  | "open"
  | "status"
  | "waiting"
  | "backups-failing"
  | "start-msfs"
  | "start-windows"
  | "version"
  | "open-data"
  | "open-backups"
  | "show-log"
  | "try-again"
  | "quit";
/** An item with `checked` is a checkbox. */
export type TrayMenuItem = { id: TrayItemId; label: string; enabled: boolean; isDefault?: true; checked?: boolean } | { separator: true };

export interface TrayInput {
  quitting: boolean;
  server: ServerState;
  /** The last status received. */
  tracker: TrayTracker | null;
  /** DailyBackups.failing(). */
  backupsFailing: string | null;
  version: string;
  backupsFolderExists: boolean;
  /** The start-list items as last read; null in test mode, or before the first read (both left out). */
  startLists: StartListItems | null;
}

export interface TrayModel {
  tooltip: string;
  dot: TrayDot;
  menu: TrayMenuItem[];
}

const STEP_WORDS: Record<string, string> = {
  opening: "opening the logbook",
  "backing-up": "backing up the logbook",
  upgrading: "upgrading the logbook",
  "bringing-in": "bringing in the logbook",
};

/** Windows keeps at most this many UTF-16 units of a tray tooltip and Electron drops the rest unmarked. */
const TOOLTIP_LIMIT = 127;

/** The first that applies: quitting, starting, given up, then the tracker's link holder, leg, casual mode and connection. */
// @spec DESK-SHELL-TRAY-002, DESK-SHELL-TRAY-003, DESK-SHELL-TRAY-004, DESK-SHELL-TRAY-005, DESK-SHELL-TRAY-006, DESK-SHELL-TRAY-007, DESK-SHELL-TRAY-008, DESK-SHELL-TRAY-009, DESK-SHELL-TRAY-010
export function statusLine(i: TrayInput): string {
  if (i.quitting) return "Quitting…";
  const s = i.server;
  if (s.kind === "not-started" || s.kind === "restarting") return "Starting…";
  if (s.kind === "starting") return s.step === null ? "Starting…" : `Starting… (${STEP_WORDS[s.step]})`;
  if (s.kind === "given-up") return `Not tracking: ${s.reason}`;
  const t = i.tracker;
  if (t === null) return "Sim not running";
  if (t.link_holder) return t.link_holder.text;
  if (t.phase === "airborne" || t.phase === "landed") {
    const word = t.phase === "airborne" ? "Airborne" : "Landed";
    const origin = t.leg?.origin ?? null;
    return origin === null ? word : `${word} from ${origin}`;
  }
  if (t.casual) return "Casual mode: nothing is logged";
  if (t.connected) return `Connected to ${t.sim_name ?? "the sim"}`;
  return "Sim not running";
}

/** null with none waiting; else "1 leg …" or "<n> legs waiting to be logged". */
// @spec DESK-SHELL-TRAY-011
export function waitingLine(n: number): string | null {
  if (n <= 0) return null;
  return n === 1 ? "1 leg waiting to be logged" : `${n} legs waiting to be logged`;
}

/** Red while given up, quitting or not; none while the server is not running; else from the tracker. */
// @spec DESK-SHELL-TRAY-013
export function trayDot(i: TrayInput): TrayDot {
  if (i.server.kind === "given-up") return "red";
  if (i.quitting || i.server.kind !== "running") return "none";
  const t = i.tracker;
  if (t === null) return "none";
  if (t.phase === "airborne" || t.phase === "landed") return "blue";
  if (t.casual) return "violet";
  if (t.pending.length > 0) return "amber";
  if (t.connected) return "green";
  return "none";
}

/** The menu in order, each conditional item only when it applies; every item stays enabled while quitting (the shell ignores them). */
// @spec DESK-SHELL-TRAY-015, DESK-SHELL-TRAY-016, DESK-SHELL-TRAY-018, DESK-SHELL-TRAY-019, DESK-SHELL-TRAY-020, DESK-SHELL-TRAY-026, DESK-START-MSFS-013, DESK-START-WINDOWS-007, DESK-START-TEST-001
export function trayMenu(i: TrayInput): TrayMenuItem[] {
  const sep: TrayMenuItem = { separator: true };
  const menu: TrayMenuItem[] = [
    { id: "open", label: "Open MSFS Career Map", enabled: true, isDefault: true },
    sep,
    { id: "status", label: statusLine(i), enabled: false },
  ];
  const waiting = waitingLine(i.tracker?.pending.length ?? 0);
  if (waiting !== null) menu.push({ id: "waiting", label: waiting, enabled: false });
  if (i.backupsFailing !== null) menu.push({ id: "backups-failing", label: `Backups failing: ${i.backupsFailing}`, enabled: false });
  if (i.startLists !== null) {
    menu.push(sep, { id: "start-msfs", ...i.startLists.msfs }, { id: "start-windows", ...i.startLists.windows });
  }
  menu.push(sep, { id: "version", label: `Version ${i.version}`, enabled: false }, sep);
  menu.push({ id: "open-data", label: "Open data folder", enabled: true });
  if (i.backupsFolderExists) menu.push({ id: "open-backups", label: "Open backups folder", enabled: true });
  menu.push({ id: "show-log", label: "Show log", enabled: true }, sep);
  if (i.server.kind === "given-up") menu.push({ id: "try-again", label: "Try again", enabled: true });
  menu.push({ id: "quit", label: "Quit", enabled: true });
  return menu;
}

/** The tooltip (cut to what Windows keeps), the dot and the menu. */
// @spec DESK-SHELL-TRAY-012
export function trayModel(i: TrayInput): TrayModel {
  const tooltip = `MSFS Career Map — ${statusLine(i)}`;
  return {
    tooltip: tooltip.length > TOOLTIP_LIMIT ? `${tooltip.slice(0, TOOLTIP_LIMIT - 1)}…` : tooltip,
    dot: trayDot(i),
    menu: trayMenu(i),
  };
}
