import fs from "node:fs";
import { APP_ID, TOAST_CLSID } from "./identity.ts";
import type { Registrations } from "./ports.ts";
import { aumidKey, clearHistoryArgs, clsidKey, lacksClsid, regDeleteKeyArgs, startMenuShortcut } from "./toast.ts";
import { run } from "./windows-facts.ts";

/**
 * The real notification registrations: at an installed copy's start, the AppUserModelID and the fixed
 * ToastActivatorCLSID set for the process (Electron then writes the CLSID's COM registration itself) and
 * the CLSID written onto the installer's Start-menu shortcut when it lacks it, never creating one; at
 * `--unregister`, the CLSID's and AppUserModelId's keys under HKCU\Software\Classes deleted and the app's
 * notifications cleared. Electron's `app` and `shell` are passed in by main.ts, so this module loads
 * without Electron.
 */

/** What `registrations` needs of Electron's `app`. */
export interface AppIds {
  setAppUserModelId(id: string): void;
  setToastActivatorCLSID(id: string): void;
}

/** What `registrations` needs of Electron's `shell`. */
export interface ShortcutLinks {
  readShortcutLink(file: string): { toastActivatorClsid?: string };
  writeShortcutLink(file: string, operation: "update", options: { toastActivatorClsid: string; appUserModelId: string }): boolean;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// @spec DESK-SHELL-NOTE-013, DESK-SHELL-NOTE-015, DESK-SHELL-NOTE-017
export function registrations(o: { app: AppIds; shell: ShortcutLinks; appData: string }): Registrations {
  return {
    async register() {
      const problems: string[] = [];
      try {
        o.app.setAppUserModelId(APP_ID);
        o.app.setToastActivatorCLSID(TOAST_CLSID);
      } catch (e) {
        problems.push(`could not set the AppUserModelID and ToastActivatorCLSID: ${message(e)}`);
      }
      const shortcut = startMenuShortcut(o.appData);
      try {
        if (fs.existsSync(shortcut) && lacksClsid(o.shell.readShortcutLink(shortcut))) {
          const ok = o.shell.writeShortcutLink(shortcut, "update", { toastActivatorClsid: TOAST_CLSID, appUserModelId: APP_ID });
          if (!ok) problems.push(`could not write the ToastActivatorCLSID onto ${shortcut}`);
        }
      } catch (e) {
        problems.push(`could not write the ToastActivatorCLSID onto ${shortcut}: ${message(e)}`);
      }
      return problems;
    },

    async remove() {
      const problems: string[] = [];
      for (const key of [clsidKey(), aumidKey()]) {
        // reg query fails when the key is absent: nothing to remove.
        if (!(await run("reg.exe", ["query", key])).ok) continue;
        const r = await run("reg.exe", regDeleteKeyArgs(key));
        if (!r.ok) problems.push(`reg delete ${key}: ${r.message}`);
      }
      const cleared = await run("powershell.exe", clearHistoryArgs());
      if (!cleared.ok) problems.push(`the notification centre could not be cleared: ${cleared.message}`);
      return problems;
    },
  };
}
