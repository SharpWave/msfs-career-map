import { execFile } from "node:child_process";
import type { KnownFolders, WindowsFacts } from "./ports.ts";

/**
 * What the shell asks Windows: MSFS running for this account, a process's program file, ending a
 * process, the excluded port ranges, a drive's type and the Documents folder. The commands' arguments
 * and the readers of their output are plain functions; only `windowsFacts()` and `knownFolders()` run
 * anything.
 */

type Env = Readonly<Record<string, string | undefined>>;

/** MSFS 2024's and MSFS 2020's programs. */
export const MSFS_PROGRAMS = ["FlightSimulator2024.exe", "FlightSimulator.exe"] as const;

export const NETSH_ARGS = ["int", "ipv4", "show", "excludedportrange", "protocol=tcp"] as const;

/** The user's `Personal` shell folder: the value the server reads at each backup (src/server/documents.ts). */
export const DOCUMENTS_ARGS = ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders", "/v", "Personal"] as const;

const COMMAND_TIMEOUT_MS = 10_000;

/** This Windows account as tasklist names it: `<domain>\<user>`. */
export function windowsUser(env: Env): string {
  return `${env.USERDOMAIN}\\${env.USERNAME}`;
}

/** tasklist filtered by the account and the program together: by the account alone it takes some 25 s. */
export function tasklistArgs(user: string, exe: string): string[] {
  return ["/FI", `USERNAME eq ${user}`, "/FI", `IMAGENAME eq ${exe}`, "/FO", "CSV", "/NH"];
}

/** Whether some line's first CSV field is the program, ignoring case (tasklist's localized INFO line never matches). */
export function tasklistHas(stdout: string, exe: string): boolean {
  const wanted = exe.toLowerCase();
  return stdout.split(/\r?\n/).some((line) => {
    const first = line.startsWith('"') ? line.slice(1, line.indexOf('"', 1)) : line.split(",")[0];
    return first.toLowerCase() === wanted;
  });
}

export function processPathArgs(pid: number): string[] {
  return ["-NoProfile", "-NonInteractive", "-Command", `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).Path`];
}

export function driveTypeArgs(letter: string): string[] {
  return ["-NoProfile", "-NonInteractive", "-Command", `[System.IO.DriveInfo]::new('${letter}').DriveType`];
}

export function isFixedDriveOutput(stdout: string): boolean {
  return stdout.trim() === "Fixed";
}

/** `%NAME%` replaced from env, the name matched ignoring case as Windows does; an unknown name left as it is. */
function expand(value: string, env: Env): string {
  return value.replace(/%([^%]+)%/g, (whole, name: string) => {
    const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
    const found = key === undefined ? undefined : env[key];
    return found ?? whole;
  });
}

/** The Personal value in reg.exe's output, expanded; null when no line names it. */
export function parseDocumentsOutput(stdout: string, env: Env): string | null {
  const m = /^\s*Personal\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/m.exec(stdout);
  return m ? expand(m[1], env) : null;
}

/** Runs a program hidden, bounded by 10 s: its stdout, or the error. Never rejects. */
function run(file: string, args: readonly string[]): Promise<{ ok: true; stdout: string } | { ok: false; message: string }> {
  return new Promise((resolve) => {
    try {
      execFile(file, [...args], { windowsHide: true, timeout: COMMAND_TIMEOUT_MS }, (err, stdout) => {
        resolve(err ? { ok: false, message: err.message } : { ok: true, stdout: String(stdout) });
      });
    } catch (e) {
      resolve({ ok: false, message: e instanceof Error ? e.message : String(e) });
    }
  });
}

/** The real WindowsFacts, by tasklist, PowerShell and netsh. */
// @spec DESK-SHELL-AWAY-001, DESK-SHELL-SRV-029, DESK-SHELL-SRV-034
export function windowsFacts(env: Env): WindowsFacts {
  const user = windowsUser(env);
  return {
    async msfsRunning() {
      const looks = await Promise.all(MSFS_PROGRAMS.map((exe) => run("tasklist.exe", tasklistArgs(user, exe))));
      return looks.some((r, i) => r.ok && tasklistHas(r.stdout, MSFS_PROGRAMS[i]));
    },
    async programOf(pid) {
      const r = await run("powershell.exe", processPathArgs(pid));
      if (!r.ok) return null;
      const file = r.stdout.trim();
      return file === "" ? null : file;
    },
    endProcess(pid) {
      try {
        process.kill(pid);
      } catch {
        // Gone already.
      }
    },
    async excludedPortRanges() {
      const r = await run("netsh.exe", NETSH_ARGS);
      return r.ok ? r.stdout : r.message;
    },
    async isFixedDrive(letter) {
      const r = await run("powershell.exe", driveTypeArgs(letter));
      return r.ok && isFixedDriveOutput(r.stdout);
    },
  };
}

/** Documents as the registry names it now, looked up afresh at every call: never Electron's path service, which keeps its first answer. */
// @spec DESK-SHELL-SRV-009, DESK-SHELL-TRAY-025
export function knownFolders(env: Env): KnownFolders {
  return {
    async documents() {
      const r = await run("reg.exe", DOCUMENTS_ARGS);
      return r.ok ? parseDocumentsOutput(r.stdout, env) : null;
    },
  };
}
