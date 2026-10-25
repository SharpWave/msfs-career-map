/**
 * The installer round trip, run by the release workflow alone on its clean GitHub-hosted runner
 * (DESK-DIST-TRIP-001; refused anywhere else before it touches anything, DESK-DIST-TRIP-007). It seeds
 * the real data and backups folders, refuses a foreign install folder, installs silently, starts the
 * app, installs a newer build over the running app, then uninstalls, checking after each step that the
 * seeded logbook and backups are untouched and, at the end, that nothing of the app is left.
 *
 *   npx tsx scripts/release/round-trip.ts --first <installer.exe> --newer <installer.exe>
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ROUND_TRIP_REFUSED, roundTripAllowed } from "./guard.ts";
import { seedLogbook, seededBackupNames } from "./seed.ts";

const PRODUCT = "MSFS Career Map";
const PORT = 3380;
const TOAST_CLSID = "{69576F59-9E6C-4DE8-8C3F-10C5489AA31F}";
const SHELL_FOLDERS = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders";

// @spec DESK-DIST-TRIP-001, DESK-DIST-TRIP-007
if (!roundTripAllowed(process.env)) {
  console.error(ROUND_TRIP_REFUSED);
  process.exit(1);
}

const args = process.argv.slice(2);
const argOf = (name: string): string => {
  const i = args.indexOf(name);
  if (i < 0 || !args[i + 1]) throw new Error(`round trip: ${name} <installer.exe> is required`);
  return path.resolve(args[i + 1]);
};
const FIRST = argOf("--first");
const NEWER = argOf("--newer");

const env = process.env as Record<string, string | undefined>;
const LOCAL = env.LOCALAPPDATA!;
const ROAMING = env.APPDATA!;
const INSTALL = path.join(LOCAL, "Programs", PRODUCT);
const PROGRAM = path.join(INSTALL, `${PRODUCT}.exe`);
const UNINSTALLER = path.join(INSTALL, `Uninstall ${PRODUCT}.exe`);
const DATA = path.join(LOCAL, PRODUCT);
const DOWNLOADS = path.join(LOCAL, "msfs-career-map-updater");
const START_MENU = path.join(ROAMING, "Microsoft", "Windows", "Start Menu", "Programs", `${PRODUCT}.lnk`);

/** A folder from the registry's User Shell Folders, %NAME% expanded. */
function shellFolder(name: "Personal" | "Desktop"): string {
  const out = execFileSync("reg.exe", ["query", SHELL_FOLDERS, "/v", name], { encoding: "utf8" });
  const m = new RegExp(`^\\s*${name}\\s+REG_(?:EXPAND_)?SZ\\s+(.+?)\\s*$`, "m").exec(out);
  if (!m) throw new Error(`round trip: no ${name} folder in ${SHELL_FOLDERS}`);
  return m[1].replace(/%([^%]+)%/g, (whole, v: string) => env[Object.keys(env).find((k) => k.toLowerCase() === v.toLowerCase()) ?? ""] ?? whole);
}
const BACKUPS = path.join(shellFolder("Personal"), PRODUCT, "Backups");
const DESKTOP_LINK = path.join(shellFolder("Desktop"), `${PRODUCT}.lnk`);

const failures: string[] = [];
function check(ok: boolean, what: string): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
}
function step(name: string): void {
  console.log(`\n== ${name}`);
}

/** reg.exe query's exit code: 0 when the key (or value) exists. */
function regHas(key: string, value?: string): boolean {
  const r = spawnSync("reg.exe", ["query", key, ...(value ? ["/v", value] : [])], { encoding: "utf8" });
  return r.status === 0;
}
/** The app's entry in Windows' Apps list, found by its display name under HKCU's Uninstall key. */
function uninstallEntry(): string | null {
  const r = spawnSync("reg.exe", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall", "/s", "/f", PRODUCT, "/d"], { encoding: "utf8" });
  if (r.status !== 0) return null;
  const key = /^(HKEY_CURRENT_USER\\\S.*)$/m.exec(r.stdout);
  return key ? key[1].trim() : null;
}
function displayVersion(): string | null {
  const key = uninstallEntry();
  if (!key) return null;
  const r = spawnSync("reg.exe", ["query", key, "/v", "DisplayVersion"], { encoding: "utf8" });
  return /DisplayVersion\s+REG_SZ\s+(\S+)/.exec(r.stdout)?.[1] ?? null;
}

/** Ids of processes whose program lies inside the install folder. */
function appProcesses(): number[] {
  const command = `Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith('${INSTALL.replace(/'/g, "''")}\\', [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { $_.Id }`;
  const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8" });
  return out.split(/\r?\n/).filter((l) => /^\d+$/.test(l.trim())).map(Number);
}

/** Runs an installer or uninstaller, waiting for it; its exit code. */
function runInstaller(file: string, switches: string[]): number {
  const r = spawnSync(file, switches, { stdio: "inherit", timeout: 10 * 60_000 });
  return r.status ?? -1;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(what: string, ok: () => boolean | Promise<boolean>, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await ok()) return true;
    await sleep(1000);
  }
  console.log(`  (gave up waiting for ${what} after ${ms / 1000} s)`);
  return false;
}
async function appReady(): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/status`, { signal: AbortSignal.timeout(2000) });
    return r.ok && ((await r.json()) as { ready?: boolean }).ready === true;
  } catch {
    return false;
  }
}
async function appAnswers(): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${PORT}/api/status`, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// The seeded logbook and backups, and the check that they are untouched (TRIP-003, TRIP-004)

const sha256 = (file: string) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const LOGBOOK_ID = crypto.randomBytes(8).toString("hex");
const DB = path.join(DATA, "career.db");
let seededHops = "";
const seededBackups: { file: string; hash: string }[] = [];

function hopsOf(file: string): string {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return JSON.stringify(db.prepare("SELECT id, aircraft_id, seq, origin, dest, departed_at, arrived_at, duration_min, notes FROM hops ORDER BY id").all());
  } finally {
    db.close();
  }
}

// @spec DESK-DIST-TRIP-003
function seed(): void {
  step("Seed the data and backups folders");
  for (const folder of [DATA, BACKUPS, INSTALL, DOWNLOADS]) check(!fs.existsSync(folder), `${folder} absent on the clean runner`);
  fs.mkdirSync(DATA, { recursive: true });
  const { hops } = seedLogbook(DB, LOGBOOK_ID);
  seededHops = hopsOf(DB);
  fs.mkdirSync(BACKUPS, { recursive: true });
  for (const name of seededBackupNames(LOGBOOK_ID, new Date())) {
    const file = path.join(BACKUPS, name);
    fs.copyFileSync(DB, file);
    seededBackups.push({ file, hash: sha256(file) });
  }
  console.log(`  logbook ${LOGBOOK_ID}: ${hops} hops; backups ${seededBackups.map((b) => path.basename(b.file)).join(", ")}`);
}

// @spec DESK-DIST-TRIP-004
function checkSeeded(after: string): void {
  check(fs.existsSync(DB) && hopsOf(DB) === seededHops, `after ${after}: the seeded logbook holds the same hops`);
  for (const b of seededBackups) {
    check(fs.existsSync(b.file) && sha256(b.file) === b.hash, `after ${after}: ${path.basename(b.file)} still there, unchanged`);
  }
}

// ---------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  seed();

  // @spec DESK-DIST-TRIP-006, DESK-DIST-INST-010
  step("An install into another folder is refused and writes nothing");
  const elsewhere = path.join(path.parse(LOCAL).root, "RoundTripElsewhere");
  const refused = runInstaller(FIRST, ["/S", `/D=${elsewhere}`]);
  check(refused !== 0, `/D=${elsewhere} refused (exit code ${refused})`);
  check(!fs.existsSync(elsewhere), "nothing left in the other folder");
  check(!fs.existsSync(INSTALL), "nothing written to the install folder");
  check(uninstallEntry() === null, "no Apps entry");
  check(!fs.existsSync(START_MENU), "no Start-menu entry");
  checkSeeded("the refused install");

  // @spec DESK-DIST-TRIP-002, DESK-DIST-INST-006, DESK-DIST-INST-007, DESK-DIST-INST-009, DESK-DIST-INST-020, DESK-DIST-INST-021
  step("Install silently");
  check(runInstaller(FIRST, ["/S"]) === 0, "the silent install exits 0");
  check(fs.existsSync(PROGRAM), `the program is ${PROGRAM}`);
  check(fs.existsSync(START_MENU), "the Start-menu entry is there");
  check(fs.existsSync(DESKTOP_LINK), "the desktop shortcut is there");
  check(uninstallEntry() !== null, "the Apps entry is there");
  await sleep(5000);
  check(appProcesses().length === 0, "a silent first install starts nothing");
  checkSeeded("the silent install");

  step("Start the app");
  const app = spawn(PROGRAM, [], { detached: true, stdio: "ignore" });
  app.unref();
  check(await until("the app's server", appReady, 180_000), `the app answers ready on port ${PORT}`);
  checkSeeded("starting the app");

  // @spec DESK-DIST-TRIP-008
  step("Prepare: the pilot deleted the desktop shortcut; the download folder holds a file");
  fs.rmSync(DESKTOP_LINK, { force: true });
  fs.mkdirSync(DOWNLOADS, { recursive: true });
  const marker = path.join(DOWNLOADS, "round-trip-marker.txt");
  fs.writeFileSync(marker, "kept by an install over the installed copy");
  const firstVersion = displayVersion();

  // @spec DESK-DIST-TRIP-002, DESK-DIST-TRIP-008, DESK-DIST-INST-008, DESK-DIST-INST-015, DESK-DIST-INST-016, DESK-DIST-INST-023, DESK-DIST-INST-024
  step("Install the newer build silently over the running app");
  check(runInstaller(NEWER, ["/S"]) === 0, "the install over the running app exits 0");
  const newerVersion = displayVersion();
  check(newerVersion !== null && newerVersion !== firstVersion, `the Apps entry now names the newer version (${firstVersion} → ${newerVersion})`);
  check(fs.existsSync(PROGRAM), "the program is there");
  await sleep(5000);
  check(appProcesses().length === 0, "the running copy was closed and, with no start asked for, left stopped");
  check(!(await appAnswers()), `nothing answers on port ${PORT}`);
  check(fs.existsSync(START_MENU), "the Start-menu entry is still there");
  check(!fs.existsSync(DESKTOP_LINK), "the desktop shortcut the pilot deleted is still absent");
  check(fs.existsSync(marker), "the download folder still holds its file");
  checkSeeded("the install over the running app");

  // @spec DESK-DIST-TRIP-002, DESK-DIST-TRIP-005, DESK-DIST-UNINST-004, DESK-DIST-UNINST-005, DESK-DIST-UNINST-007, DESK-DIST-UNINST-013
  step("Uninstall silently");
  check(fs.existsSync(UNINSTALLER), "the uninstaller is in the install folder");
  runInstaller(UNINSTALLER, ["/S"]);
  // The uninstaller copies itself out of the folder it removes and runs from there: wait for it.
  await until("the uninstall", () => !fs.existsSync(INSTALL) && uninstallEntry() === null, 180_000);
  check(!fs.existsSync(INSTALL), "no program folder");
  check(!fs.existsSync(START_MENU), "no Start-menu entry");
  check(!fs.existsSync(DESKTOP_LINK), "no desktop shortcut");
  check(uninstallEntry() === null, "no Apps entry");
  check(!regHas("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", PRODUCT), "no Run value");
  check(!regHas("HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run", PRODUCT), "no StartupApproved value");
  check(!regHas(`HKCU\\Software\\Classes\\CLSID\\${TOAST_CLSID}`), "no ToastActivatorCLSID registration");
  check(!fs.existsSync(DOWNLOADS), "no electron-updater download folder");
  checkSeeded("the uninstall");

  if (failures.length > 0) {
    console.error(`\nThe round trip failed ${failures.length} check(s):\n${failures.map((f) => `  - ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log("\nThe round trip passed.");
}

await main();
