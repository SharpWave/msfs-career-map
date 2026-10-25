import path from "node:path";
import type { RunPlan } from "./start.ts";

/** The name Windows shows for the server's process. */
export const SERVICE_NAME = "MSFS Career Map server";

/** The variables that steer a copy run from source; never passed to the app's server. */
export const REMOVED_ENV = [
  "PORT",
  "CAREER_DB",
  "TRACKER",
  "TRACKER_FAKE",
  "SIMCONNECT_HOST",
  "SIMCONNECT_PORT",
  "NODE_OPTIONS",
  "ELECTRON_RUN_AS_NODE",
] as const;

const REMOVED = new Set<string>(REMOVED_ENV.map((n) => n.toUpperCase()));

/**
 * The server's start-up arguments, in app-shell's names: folders and port, the backups folder (a
 * literal path in test mode, Documents looked up by the server at each backup outside it), sim,
 * airport downloads, the logbook to offer and the fresh run. No address and no version.
 */
// @spec DESK-SHELL-SRV-004, DESK-SHELL-SRV-005, DESK-SHELL-SRV-006, DESK-SHELL-SRV-008, DESK-SHELL-SRV-041, DESK-SHELL-SRV-044
export function serverArgs(plan: RunPlan, programFolder: string, o: { offer: string | null; freshRun: boolean }): string[] {
  const args = [`--data=${plan.dataFolder}`, `--program=${programFolder}`, `--port=${plan.port}`];
  args.push(plan.backups.kind === "folder" ? `--backups=${plan.backups.folder}` : `--backups-documents=${plan.backups.path}`);
  args.push(`--sim=${plan.sim}`, `--airport-downloads=${plan.airportDownloads ? "on" : "off"}`);
  if (o.offer !== null) args.push(`--offer=${o.offer}`);
  if (o.freshRun) args.push("--fresh-run");
  return args;
}

/** A copy of env without REMOVED_ENV, matched ignoring case; undefined values dropped. */
// @spec DESK-SHELL-SRV-010
export function serverEnv(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined && !REMOVED.has(name.toUpperCase())) out[name] = value;
  }
  return out;
}

/** Test mode: plan.backups.folder. Installed: <documents>\MSFS Career Map\Backups, or null when documents is null. */
export function backupsFolderFor(plan: RunPlan, documents: string | null): string | null {
  if (plan.backups.kind === "folder") return plan.backups.folder;
  return documents === null ? null : path.win32.join(documents, plan.backups.path);
}

/** http://127.0.0.1:<port>/ */
export function pageUrl(port: number): string {
  return `http://127.0.0.1:${port}/`;
}
