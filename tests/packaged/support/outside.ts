/**
 * What the packaged smoke test must leave as it found it outside its own temporary folders
 * (DESK-DIST-SMOKE-011): the sim's two EXE.xml files, Windows' two start-up keys (Run and
 * StartupApproved\Run), the ToastActivatorCLSID's key under HKCU\Software\Classes, the installed app's
 * Start-menu shortcut, and the installed app's four folders.
 *
 * Everything here only reads: `reg query`, file reads and folder listings, and one PowerShell look at
 * the running processes. `compareOutside` is pure.
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DOCUMENTS_ARGS, parseDocumentsOutput } from "../../../src/desktop/windows-facts.ts";

/** The ToastActivatorCLSID chosen once (DESK-DIST-PKG-002). */
export const TOAST_CLSID = "{69576F59-9E6C-4DE8-8C3F-10C5489AA31F}";

export const REGISTRY_KEYS = [
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run",
  "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run",
  `HKCU\\Software\\Classes\\CLSID\\${TOAST_CLSID}`,
] as const;

/** A folder listing: each entry's path relative to the folder ("/" between parts), with "dir" or "<size> <mtimeMs>". */
export type Listing = Record<string, string>;

export interface Snapshot {
  /** `reg query <key> /s` output, byte for byte (latin1); null when the key is absent. */
  registry: Record<string, string | null>;
  /** Each file's SHA-256 and size; null when absent; "unreadable: <code>" when it could not be read. */
  files: Record<string, string | null>;
  /** Each folder's listing; null when absent. */
  folders: Record<string, Listing | null>;
  /** The ids of the installed app's processes (`MSFS Career Map.exe` in the install folder); null when the look failed. */
  installedRunning: number[] | null;
}

type Env = Readonly<Record<string, string | undefined>>;

function need(env: Env, name: string): string {
  const v = env[name];
  if (!v) throw new Error(`%${name}% is not set`);
  return v;
}

/** The install folder's program: `%LOCALAPPDATA%\Programs\MSFS Career Map\MSFS Career Map.exe`. */
export function installedProgram(env: Env = process.env): string {
  return path.win32.join(need(env, "LOCALAPPDATA"), "Programs", "MSFS Career Map", "MSFS Career Map.exe");
}

/** The files SMOKE-011 compares byte for byte. */
export function outsideFiles(env: Env = process.env): string[] {
  const local = need(env, "LOCALAPPDATA");
  const roaming = need(env, "APPDATA");
  return [
    path.win32.join(local, "Packages", "Microsoft.Limitless_8wekyb3d8bbwe", "LocalCache", "EXE.xml"),
    path.win32.join(roaming, "Microsoft Flight Simulator 2024", "EXE.xml"),
    path.win32.join(roaming, "Microsoft", "Windows", "Start Menu", "Programs", "MSFS Career Map.lnk"),
  ];
}

/** Documents as the registry names it (as the app reads it), else `%USERPROFILE%\Documents`. */
function documentsFolder(env: Env): string {
  try {
    const out = execFileSync("reg.exe", [...DOCUMENTS_ARGS], { windowsHide: true, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const found = parseDocumentsOutput(out, env);
    if (found) return found;
  } catch {
    // Fall through to the usual place.
  }
  return path.win32.join(need(env, "USERPROFILE"), "Documents");
}

/** The installed app's folders SMOKE-011 lists: data, Electron's own, `MSFS Career Map` in Documents, electron-updater's downloads. */
export function outsideFolders(env: Env = process.env): string[] {
  const local = need(env, "LOCALAPPDATA");
  const roaming = need(env, "APPDATA");
  return [
    path.win32.join(local, "MSFS Career Map"),
    path.win32.join(roaming, "MSFS Career Map"),
    path.win32.join(documentsFolder(env), "MSFS Career Map"),
    path.win32.join(local, "msfs-career-map-updater"),
  ];
}

/** `reg query <key> /s`: its output, or null when reg.exe says the key is absent (exit code 1). */
function readKey(key: string): string | null {
  try {
    return execFileSync("reg.exe", ["query", key, "/s"], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }).toString("latin1");
  } catch (e) {
    if ((e as { status?: number }).status === 1) return null;
    throw e;
  }
}

function readFileState(file: string): string | null {
  try {
    const bytes = fs.readFileSync(file);
    return `${crypto.createHash("sha256").update(bytes).digest("hex")} ${bytes.length}`;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return null;
    return `unreadable: ${code ?? String(e)}`;
  }
}

function listFolder(folder: string): Listing | null {
  let st: fs.Stats;
  try {
    st = fs.statSync(folder);
  } catch {
    return null;
  }
  if (!st.isDirectory()) return { "": `not a folder ${st.size} ${st.mtimeMs}` };
  const out: Listing = {};
  const walk = (dir: string, rel: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      out[`${rel}<unreadable>`] = (e as NodeJS.ErrnoException).code ?? String(e);
      return;
    }
    for (const d of entries) {
      const full = path.join(dir, d.name);
      const r = rel === "" ? d.name : `${rel}/${d.name}`;
      if (d.isDirectory()) {
        out[`${r}/`] = "dir";
        walk(full, r);
      } else {
        try {
          const s = fs.statSync(full);
          out[r] = `${s.size} ${s.mtimeMs}`;
        } catch (e) {
          out[r] = `unreadable: ${(e as NodeJS.ErrnoException).code ?? String(e)}`;
        }
      }
    }
  };
  walk(folder, "");
  return out;
}

/** The ids of processes running the installed program; null when PowerShell could not look. */
function installedProcesses(env: Env): number[] | null {
  const exe = installedProgram(env).replace(/'/g, "''");
  // Get-Process finding no such process is an error that sets PowerShell's exit code; none found is not a failure here.
  const command =
    `Get-Process -Name 'MSFS Career Map' -ErrorAction SilentlyContinue | ` +
    `Where-Object { $_.Path -and $_.Path -ieq '${exe}' } | ForEach-Object { $_.Id }; exit 0`;
  try {
    const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], {
      windowsHide: true,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 30_000,
    });
    return out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^\d+$/.test(l))
      .map(Number);
  } catch {
    return null;
  }
}

/** SMOKE-011's look at everything outside the test's folders. Reads only. */
export async function snapshotOutside(env: Env = process.env): Promise<Snapshot> {
  const registry: Record<string, string | null> = {};
  for (const key of REGISTRY_KEYS) registry[key] = readKey(key);
  const files: Record<string, string | null> = {};
  for (const f of outsideFiles(env)) files[f] = readFileState(f);
  const folders: Record<string, Listing | null> = {};
  for (const f of outsideFolders(env)) folders[f] = listFolder(f);
  return { registry, files, folders, installedRunning: installedProcesses(env) };
}

/** Whether the installed app's folders may be compared file for file: no process of it ran at either look. */
function foldersComparable(before: Snapshot, after: Snapshot): boolean {
  return before.installedRunning !== null && after.installedRunning !== null && before.installedRunning.length === 0 && after.installedRunning.length === 0;
}

/** Why the folders were not compared file for file, when one of them exists and they could not be; else null. */
export function folderComparisonSkipped(before: Snapshot, after: Snapshot): string | null {
  if (foldersComparable(before, after)) return null;
  const present = Object.keys({ ...before.folders, ...after.folders }).filter((f) => before.folders[f] != null && after.folders[f] != null);
  if (present.length === 0) return null;
  const why = (s: Snapshot, when: string) =>
    s.installedRunning === null ? `the installed app's processes could not be looked up ${when}` : s.installedRunning.length > 0 ? `the installed app was running ${when} (pid ${s.installedRunning.join(", ")})` : null;
  const reasons = [why(before, "before the run"), why(after, "after the run")].filter((r): r is string => r !== null);
  return `The installed app's folders (${present.join("; ")}) were not compared file for file: ${reasons.join(" and ")}, and a running installed app changes its own folders.`;
}

function presence(v: unknown): string {
  return v === null || v === undefined ? "absent" : "present";
}

/** A few lines naming what differs between two listings of one folder. */
function listingDifferences(folder: string, b: Listing, a: Listing): string[] {
  const out: string[] = [];
  for (const k of Object.keys({ ...b, ...a }).sort()) {
    if (!(k in b)) out.push(`${folder}: ${k} appeared`);
    else if (!(k in a)) out.push(`${folder}: ${k} went`);
    else if (b[k] !== a[k]) out.push(`${folder}: ${k} changed (${b[k]} → ${a[k]})`);
  }
  return out.length > 10 ? [...out.slice(0, 10), `${folder}: and ${out.length - 10} more differences`] : out;
}

/**
 * The differences between two looks, one line each; empty when the same. Registry keys and files are
 * compared byte for byte, present or absent; a folder absent before must be absent after; a folder
 * present is compared file for file only when no process of the installed app ran at either look
 * (`folderComparisonSkipped` gives the note otherwise).
 */
export function compareOutside(before: Snapshot, after: Snapshot): string[] {
  const out: string[] = [];
  for (const key of Object.keys({ ...before.registry, ...after.registry })) {
    const b = before.registry[key] ?? null;
    const a = after.registry[key] ?? null;
    if (b === a) continue;
    out.push(b === null || a === null ? `registry ${key}: ${presence(b)} before, ${presence(a)} after` : `registry ${key}: changed`);
  }
  for (const file of Object.keys({ ...before.files, ...after.files })) {
    const b = before.files[file] ?? null;
    const a = after.files[file] ?? null;
    if (b === a) continue;
    out.push(b === null || a === null ? `file ${file}: ${presence(b)} before, ${presence(a)} after` : `file ${file}: changed`);
  }
  const comparable = foldersComparable(before, after);
  for (const folder of Object.keys({ ...before.folders, ...after.folders })) {
    const b = before.folders[folder] ?? null;
    const a = after.folders[folder] ?? null;
    if (b === null && a === null) continue;
    if (b === null) {
      out.push(`folder ${folder}: absent before, present after`);
      continue;
    }
    if (!comparable) continue;
    if (a === null) {
      out.push(`folder ${folder}: present before, absent after`);
      continue;
    }
    out.push(...listingDifferences(`folder ${folder}`, b, a));
  }
  return out;
}
