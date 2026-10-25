import path from "node:path";
import { EARLIER_PROGRAMS, type Programs } from "./exe-xml.ts";
import { installedProgramPath } from "./installed.ts";
import { LogFile } from "./logs.ts";
import { editionFolders, unregisterMsfs } from "./msfs-start.ts";
import type { Clock, EditorFs, Registrations, StartupKeys } from "./ports.ts";
import { SettingsStore } from "./settings.ts";
import type { RunPlan } from "./start.ts";
import { BACKUPS_FOLDER } from "./start-list-backups.ts";
import { turnWindowsOff } from "./windows-start.ts";

/**
 * `--unregister`, the uninstaller's clean-up of the start lists: every entry of the app's out of every
 * `EXE.xml` present and the app's value out of Windows' start-up keys, both at once, each outcome in
 * desktop.log and never a box, bounded by 15 s. Its exit code says which list still holds the app's
 * entry or could not be checked: 1 an EXE.xml, 2 the keys, 3 both. Beside them it removes the notification
 * registrations and clears the app's notifications, an outcome that only goes to desktop.log. In test mode
 * it reaches neither list nor any registration.
 */

export const UNREGISTER_LIMIT_MS = 15_000;

/** Bit 1: an EXE.xml still holds the app's entry or could not be checked; bit 2: Windows' start-up keys. */
const EXE_XML = 1;
const KEYS = 2;

export interface UnregisterPorts {
  plan: RunPlan;
  env: { LOCALAPPDATA?: string; APPDATA?: string };
  clock: Clock;
  fs: EditorFs;
  keys: StartupKeys;
  registrations: Registrations;
  programs?: Programs;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The exit code. Test mode: one line to <folder>\desktop\logs\desktop.log, nothing else, 0. */
// @spec DESK-START-UNREG-001, DESK-START-UNREG-002, DESK-START-UNREG-003, DESK-START-UNREG-004, DESK-START-UNREG-005, DESK-START-UNREG-006, DESK-START-UNREG-007, DESK-START-UNREG-008, DESK-START-TEST-002, DESK-SHELL-CLI-009, DESK-SHELL-NOTE-016, DESK-SHELL-NOTE-017
export async function runUnregister(o: UnregisterPorts): Promise<0 | 1 | 2 | 3> {
  const { plan, clock } = o;
  const desktopLog = new LogFile({ folder: path.win32.join(plan.electronFolder, "logs"), name: "desktop", clock });
  const log = (line: string) => desktopLog.write(line);
  if (plan.mode === "test") {
    log(`[unregister] test mode on ${plan.testFolder}: neither start list is reached`);
    return 0;
  }
  log("[unregister] taking MSFS Career Map off the start lists");
  const programs = o.programs ?? { program: installedProgramPath(o.env.LOCALAPPDATA ?? ""), earlier: EARLIER_PROGRAMS };
  const backupsFolder = path.win32.join(plan.electronFolder, BACKUPS_FOLDER);
  const settings = new SettingsStore(plan.electronFolder, log);
  settings.load();

  const exeXml = unregisterMsfs({
    fs: o.fs,
    clock,
    programs,
    folders: editionFolders(o.env),
    backupsFolder,
    record: {
      get: () => [...settings.get().exeXmlFiles],
      set: (files) => settings.update((s) => (s.exeXmlFiles = [...files])),
    },
    log,
  }).then(
    (r) => (r.outcomes.some((x) => x.kind === "left") ? EXE_XML : 0),
    (e: unknown) => {
      log(`[unregister] the EXE.xml files could not be checked: ${message(e)}`);
      return EXE_XML;
    },
  );
  const keys = turnWindowsOff({ keys: o.keys, fs: o.fs, clock, program: programs.program, backupsFolder, log }).then(
    (r) => (r.kind === "left" ? KEYS : 0),
    (e: unknown) => {
      log(`[unregister] Windows' start-up keys could not be checked: ${message(e)}`);
      return KEYS;
    },
  );

  // The registrations' outcome is logged and never counted in the exit code.
  let registrationsDone = false;
  const notifications = o.registrations
    .remove()
    .catch((e: unknown) => [message(e)])
    .then((problems) => {
      log(
        problems.length === 0
          ? "[unregister] notification registrations removed"
          : `[unregister] notification registrations could not be removed: ${problems.join("; ")}`,
      );
      registrationsDone = true;
    });

  return new Promise((resolve) => {
    const done: { exeXml: number | null; keys: number | null } = { exeXml: null, keys: null };
    let settled = false;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      cancel();
      log(`[unregister] exit code ${code}`);
      resolve(code as 0 | 1 | 2 | 3);
    };
    const cancel = clock.after(UNREGISTER_LIMIT_MS, () => {
      const unfinished = [done.exeXml === null ? "the EXE.xml files" : null, done.keys === null ? "Windows' start-up keys" : null].filter(Boolean);
      log(`[unregister] stopped after ${UNREGISTER_LIMIT_MS / 1000} s: ${unfinished.join(" and ")} not done`);
      finish((done.exeXml ?? EXE_XML) | (done.keys ?? KEYS));
    });
    const check = () => {
      if (done.exeXml !== null && done.keys !== null && registrationsDone) finish(done.exeXml | done.keys);
    };
    void notifications.then(check);
    void exeXml.then((bit) => {
      done.exeXml = bit;
      check();
    });
    void keys.then((bit) => {
      done.keys = bit;
      check();
    });
  });
}
