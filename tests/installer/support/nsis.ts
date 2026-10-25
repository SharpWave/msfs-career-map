/**
 * Support for the include's tests (m3 contract §7; DESK-DIST-INCL-001, DESK-DIST-INCL-002): makensis
 * from electron-builder's own NSIS, a temp folder standing in for every folder an install touches or
 * must leave alone, test programs built from the steps file (`build/installer-steps.nsh`) and run on
 * that folder, a fake app program, ending what a test started, and a read-only snapshot of
 * everything outside the temp folder an include test could touch.
 *
 * Nothing here writes outside the OS temp folder: the real install, download, data, backups and
 * Electron folders and the registry are only ever read (`outsideSnapshot`).
 */
import { execFile, spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const win = path.win32;

export const REPO = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
/** The steps file the test programs include (m3 contract §4.2). */
export const STEPS_FILE = win.join(REPO, "build", "installer-steps.nsh");
/** The program name inside the install folder, the fake app's too. */
export const EXE_NAME = "MSFS Career Map.exe";

// ---------------------------------------------------------------------------------------------
// makensis

let makensisFound: Promise<{ path: string; env: NodeJS.ProcessEnv }> | undefined;

/** makensis from electron-builder's own NSIS (app-builder-lib's toolsets/windows getMakeNsisPath). */
export function makensis(): Promise<{ path: string; env: NodeJS.ProcessEnv }> {
  makensisFound ??= (async () => {
    const require = createRequire(path.join(REPO, "package.json"));
    const toolsets = require("app-builder-lib/out/toolsets/windows.js") as {
      getMakeNsisPath(nsis?: string, customBinary?: unknown): Promise<{ path: string; env?: Record<string, string> }>;
    };
    // No `toolsets.nsis` in the configuration: electron-builder's default NSIS, the one it builds with.
    const found = await toolsets.getMakeNsisPath(undefined, undefined);
    return { path: found.path, env: found.env ?? {} };
  })();
  return makensisFound;
}

/** Runs makensis on `script`; throws with its output when it fails. */
async function compile(script: string): Promise<void> {
  const m = await makensis();
  const result = await new Promise<{ code: number; output: string }>((resolve) => {
    execFile(
      m.path,
      ["-V2", "-INPUTCHARSET", "UTF8", script],
      { env: { ...process.env, ...m.env }, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === "number" ? error.code : 1) : 0;
        resolve({ code, output: `${stdout}${stderr}` });
      },
    );
  });
  if (result.code !== 0) {
    throw new Error(`makensis failed on ${script} (exit ${result.code}):\n${result.output.trim()}`);
  }
}

/** An NSIS string literal's content: `$` doubled (a path holds no `"`). */
function nsisText(s: string): string {
  if (s.includes('"')) throw new Error(`no '"' in an NSIS string: ${s}`);
  return s.replace(/\$/g, "$$$$");
}

/** Writes an .nsi file as UTF-8 with a BOM. */
function writeScript(file: string, text: string): void {
  fs.writeFileSync(file, "﻿" + text.replace(/\r?\n/g, "\r\n"), "utf8");
}

// ---------------------------------------------------------------------------------------------
// The stand-in folders

export interface StandIns {
  /** The temp folder holding the rest, fully resolved. */
  root: string;
  /** Stands in for `%LOCALAPPDATA%\Programs\MSFS Career Map`. */
  install: string;
  /** Stands in for electron-updater's download folder `%LOCALAPPDATA%\msfs-career-map-updater`. */
  downloads: string;
  /** `<downloads>\install-under-way`. */
  mark: string;
  /** Stand in for the data folder, the backups folder and Electron's own folder: never touched. */
  data: string;
  backups: string;
  electron: string;
  /** Somewhere else: a program of the same name started here is not the app's running copy. */
  elsewhere: string;
  /** The test programs, their scripts and `out.txt`. */
  work: string;
  /** TEMP and TMP of the test programs (NSIS's plugins folder). */
  temp: string;
}

/** A new temp folder: install\, downloads\, data\, backups\, electron\, elsewhere\, work\ (and temp\). */
export function standIns(): StandIns {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "career-map-include-")));
  const s: StandIns = {
    root,
    install: win.join(root, "install"),
    downloads: win.join(root, "downloads"),
    mark: win.join(root, "downloads", "install-under-way"),
    data: win.join(root, "data"),
    backups: win.join(root, "backups"),
    electron: win.join(root, "electron"),
    elsewhere: win.join(root, "elsewhere"),
    work: win.join(root, "work"),
    temp: win.join(root, "temp"),
  };
  for (const f of [s.install, s.downloads, s.data, s.backups, s.electron, s.elsewhere, s.work, s.temp]) {
    fs.mkdirSync(f, { recursive: true });
  }
  // Something in each folder an install must leave alone, so a step reaching it shows.
  fs.writeFileSync(win.join(s.data, "career.db"), "logbook");
  fs.writeFileSync(win.join(s.backups, "career-2026-10-24-daily.db"), "backup");
  fs.writeFileSync(win.join(s.electron, "settings.json"), "{}");
  return s;
}

/** The data, backups and Electron stand-ins' files and contents, to compare before and after. */
export function leftAlone(s: StandIns): string {
  return [s.data, s.backups, s.electron].map((f) => listing(f, true)).join("\n");
}

/** The defines a test program's body may use for the stand-in folders. */
function standInDefines(s: StandIns): string {
  const d: Record<string, string> = {
    ROOT: s.root,
    INSTALL: s.install,
    DOWNLOADS: s.downloads,
    MARK: s.mark,
    DATA: s.data,
    BACKUPS: s.backups,
    ELECTRON: s.electron,
    ELSEWHERE: s.elsewhere,
    WORK: s.work,
    PROGRAM: win.join(s.install, EXE_NAME),
  };
  return Object.entries(d)
    .map(([k, v]) => `!define ${k} "${nsisText(v)}"`)
    .join("\n");
}

// ---------------------------------------------------------------------------------------------
// Test programs

/**
 * Builds `work\<name>.exe` from a test program whose Section body is `body`, the steps file included
 * (`!insertmacro CAREER_MAP_STEPS ""`), RequestExecutionLevel user, silent; returns its path.
 *
 * The body may use the stand-ins as `${ROOT}`, `${INSTALL}`, `${DOWNLOADS}`, `${MARK}`, `${DATA}`,
 * `${BACKUPS}`, `${ELECTRON}`, `${ELSEWHERE}`, `${WORK}` and `${PROGRAM}` (the install folder's
 * `MSFS Career Map.exe`); `${Out} "text"` appends a line to `work\out.txt`, leaving $0-$9 alone;
 * `${Ticks} $8` puts GetTickCount in a variable, to time a step from inside the program (a freshly
 * built program can take seconds to start while Windows scans it, so `run`'s `ms` is no measure);
 * `$params` holds the program's own command line after its path (`run`'s `args`);
 * `!insertmacro TestBlockReasons` writes `reasons=<n>` and a `reason=<text>` line for each of the
 * process's own top-level windows holding a shutdown block reason.
 *
 * `steps` is the steps file to include: the product's, except when checking this support itself.
 */
export async function buildProgram(s: StandIns, name: string, body: string, steps = STEPS_FILE): Promise<string> {
  const exe = win.join(s.work, `${name}.exe`);
  const script = win.join(s.work, `${name}.nsi`);
  writeScript(
    script,
    `Unicode true
RequestExecutionLevel user
SilentInstall silent
Name "career-map-include-test"
OutFile "${nsisText(exe)}"

${standInDefines(s)}

!include "LogicLib.nsh"
!include "FileFunc.nsh"
!include "${nsisText(steps)}"
!insertmacro CAREER_MAP_STEPS ""

Var testOutFile
Var params

!macro TestOut TEXT
  FileOpen $testOutFile "\${WORK}\\out.txt" a
  FileSeek $testOutFile 0 END
  FileWriteUTF16LE $testOutFile "\${TEXT}$\\r$\\n"
  FileClose $testOutFile
!macroend
!define Out "!insertmacro TestOut"

; VAR := milliseconds since Windows started (GetTickCount), to time a step from inside the program.
!macro TestTicks VAR
  System::Call "kernel32::GetTickCount() i .s"
  Pop \${VAR}
!macroend
!define Ticks "!insertmacro TestTicks"

; reasons=<n>, then reason=<text> for each of this process's own top-level windows with a shutdown
; block reason (ShutdownBlockReasonQuery). Uses $R0-$R5, saved and restored.
!macro TestBlockReasons
  Push $R0
  Push $R1
  Push $R2
  Push $R3
  Push $R4
  Push $R5
  System::Call "kernel32::GetCurrentProcessId() i .R0"
  StrCpy $R1 0
  StrCpy $R5 0
  \${Do}
    System::Call "user32::FindWindowExW(p 0, p R1, p 0, p 0) p .R1"
    \${If} $R1 = 0
      \${Break}
    \${EndIf}
    System::Call "user32::GetWindowThreadProcessId(p R1, *i .R2) i"
    \${If} $R2 = $R0
      System::Call "user32::ShutdownBlockReasonQuery(p R1, w .R3, *i \${NSIS_MAX_STRLEN}) i .R4"
      \${If} $R4 <> 0
        IntOp $R5 $R5 + 1
        \${Out} "reason=$R3"
      \${EndIf}
    \${EndIf}
  \${Loop}
  \${Out} "reasons=$R5"
  Pop $R5
  Pop $R4
  Pop $R3
  Pop $R2
  Pop $R1
  Pop $R0
!macroend

Section
  \${GetParameters} $params
${body}
SectionEnd
`,
  );
  fs.rmSync(exe, { force: true });
  await compile(script);
  return exe;
}

/**
 * Runs it, waiting; returns the exit code and `work\out.txt` (the lines the body wrote, UTF-16LE on
 * disk). `args` are joined with spaces as they are, unquoted, so the body's `$params` is exactly them.
 */
export async function run(
  exe: string,
  s: StandIns,
  args: string[] = [],
): Promise<{ code: number; out: string[]; ms: number }> {
  const outFile = win.join(s.work, "out.txt");
  fs.rmSync(outFile, { force: true });
  const started = Date.now();
  const code = await new Promise<number>((resolve, reject) => {
    // stdio ignored: the programs the test program starts must not hold a pipe of ours open.
    // The stand-ins' paths hold no space, so the program's own path needs no quotes either.
    const child = spawn(exe, args, {
      env: testEnv(s),
      windowsHide: true,
      stdio: "ignore",
      windowsVerbatimArguments: true,
    });
    child.on("error", reject);
    child.on("exit", (c) => resolve(c ?? -1));
  });
  const ms = Date.now() - started;
  return { code, out: readLines(outFile), ms };
}

/** The test programs' environment: TEMP and TMP inside the stand-ins, so NSIS's plugins folder is too. */
function testEnv(s: StandIns): NodeJS.ProcessEnv {
  return { ...process.env, TEMP: s.temp, TMP: s.temp };
}

/** A UTF-16LE (or UTF-8) text file's lines, without a BOM or a last empty line; [] when missing. */
export function readLines(file: string): string[] {
  if (!fs.existsSync(file)) return [];
  const bytes = fs.readFileSync(file);
  let text: string;
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) text = bytes.subarray(2).toString("utf16le");
  else if (bytes.length >= 2 && bytes[1] === 0 && bytes[0] !== 0) text = bytes.toString("utf16le");
  else text = bytes.toString("utf8").replace(/^﻿/, "");
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

/** The value of the first `key=value` line in `out`, or undefined. */
export function value(out: string[], key: string): string | undefined {
  const line = out.find((l) => l.startsWith(`${key}=`));
  return line === undefined ? undefined : line.slice(key.length + 1);
}

/** The lines between `begin` and the next `end` line, joined with CR LF (a value spanning lines). */
export function block(out: string[], begin: string, end = "END"): string {
  const from = out.indexOf(begin);
  if (from < 0) throw new Error(`no '${begin}' in the output:\n${out.join("\n")}`);
  const to = out.indexOf(end, from + 1);
  if (to < 0) throw new Error(`no '${end}' after '${begin}' in the output`);
  return out.slice(from + 1, to).join("\r\n");
}

// ---------------------------------------------------------------------------------------------
// The fake app

/**
 * A fake app program built from NSIS as `<folder>\MSFS Career Map.exe` (the steps file not used).
 * Each start first appends its command line (after the program path, trimmed) as a line to
 * `<folder>\started-with` (UTF-16LE). Then: `--quit` → creates `<folder>\quit-asked` and exits 0;
 * `--unregister` → exits with the code in `<folder>\unregister-code` (0 when there is none), or sleeps
 * 5 min when the file holds `hang`; anything else, no switch included → waits until
 * `<folder>\quit-asked` exists (up to 5 min) then exits 0. With `ignoreQuit` it waits the 5 min whatever
 * `quit-asked` says (a copy that does not honour `--quit`).
 */
export async function fakeApp(s: StandIns, folder: string, opts: { ignoreQuit?: boolean } = {}): Promise<string> {
  fs.mkdirSync(folder, { recursive: true });
  const exe = win.join(folder, EXE_NAME);
  const script = win.join(s.work, `fake-app-${crypto.randomUUID()}.nsi`);
  writeScript(
    script,
    `Unicode true
RequestExecutionLevel user
SilentInstall silent
Name "MSFS Career Map (fake)"
OutFile "${nsisText(exe)}"
${opts.ignoreQuit ? "!define IGNORE_QUIT" : ""}

!include "LogicLib.nsh"
!include "FileFunc.nsh"

Var params
Var file
Var line
Var waited

Section
  \${GetParameters} $params
  ; trailing spaces off
  \${Do}
    StrCpy $line $params 1 -1
    \${If} $line != " "
      \${Break}
    \${EndIf}
    StrCpy $params $params -1
  \${Loop}

  FileOpen $file "$EXEDIR\\started-with" a
  FileSeek $file 0 END
  FileWriteUTF16LE $file "$params$\\r$\\n"
  FileClose $file

  \${If} $params == "--quit"
    FileOpen $file "$EXEDIR\\quit-asked" w
    FileClose $file
    SetErrorLevel 0
  \${ElseIf} $params == "--unregister"
    StrCpy $line "0"
    ClearErrors
    FileOpen $file "$EXEDIR\\unregister-code" r
    \${IfNot} \${Errors}
      FileRead $file $line
      FileClose $file
    \${EndIf}
    \${If} $line == "hang"
      Sleep 300000
      SetErrorLevel 0
    \${Else}
      IntOp $line $line + 0
      SetErrorLevel $line
    \${EndIf}
  \${Else}
    StrCpy $waited 0
    \${Do}
      !ifndef IGNORE_QUIT
        \${If} \${FileExists} "$EXEDIR\\quit-asked"
          \${Break}
        \${EndIf}
      !endif
      Sleep 100
      IntOp $waited $waited + 100
    \${LoopUntil} $waited >= 300000
    SetErrorLevel 0
  \${EndIf}
SectionEnd
`,
  );
  fs.rmSync(exe, { force: true });
  await compile(script);
  fs.rmSync(script, { force: true });
  return exe;
}

/** A program the test started itself (a fake app's running copy). */
export interface Started {
  pid: number;
  /** Still running. */
  running(): boolean;
  /** Its exit code once it exits within `ms`, else "running". */
  exited(ms: number): Promise<number | "running">;
}

/** Starts `exe` without waiting (its environment as the test programs'); ended by `cleanUp` at the latest. */
export function start(exe: string, s: StandIns, args: string[] = []): Started {
  const child = spawn(exe, args, { env: testEnv(s), windowsHide: true, stdio: "ignore" });
  let code: number | undefined;
  const exit = new Promise<number>((resolve) => {
    child.on("exit", (c) => {
      code = c ?? -1;
      resolve(code);
    });
    child.on("error", () => {
      code = -1;
      resolve(-1);
    });
  });
  if (child.pid === undefined) throw new Error(`could not start ${exe}`);
  return {
    pid: child.pid,
    running: () => code === undefined,
    exited: (ms) =>
      Promise.race([exit, new Promise<"running">((r) => setTimeout(() => r("running"), ms).unref())]),
  };
}

/** The command lines the fake app in `folder` was started with, one per start; [] when never started. */
export function startedWith(folder: string): string[] {
  return readLines(win.join(folder, "started-with"));
}

/** Waits until `check()` holds or `ms` pass; returns whether it held. */
export async function waitFor(check: () => boolean, ms: number, every = 50): Promise<boolean> {
  const until = Date.now() + ms;
  for (;;) {
    if (check()) return true;
    if (Date.now() >= until) return false;
    await new Promise((r) => setTimeout(r, every));
  }
}

// ---------------------------------------------------------------------------------------------
// Processes and clean-up

/** The ids of this user's processes whose program lies inside `folder` (ignoring case), via PowerShell. */
export function processesIn(folder: string): number[] {
  const prefix = folder.replace(/\\+$/, "") + "\\";
  const r = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith('${prefix.replace(/'/g, "''")}', [System.StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { $_.Id }`,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  return (r.stdout ?? "")
    .split(/\r?\n/)
    .map((l) => Number(l.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/** Ends every process whose program lies inside `folder` — only inside it — and waits until none is left. */
export async function endProcessesIn(folder: string): Promise<void> {
  if (!folder.toLowerCase().startsWith(fs.realpathSync.native(os.tmpdir()).toLowerCase() + "\\")) {
    throw new Error(`refusing to end processes outside the temp folder: ${folder}`);
  }
  for (let attempt = 0; attempt < 20; attempt++) {
    const ids = processesIn(folder);
    if (ids.length === 0) return;
    for (const id of ids) {
      try {
        process.kill(id);
      } catch {
        // gone meanwhile
      }
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`processes still running inside ${folder}: ${processesIn(folder).join(", ")}`);
}

/** Ends every process started inside the stand-ins, then removes them. */
export async function cleanUp(s: StandIns | undefined): Promise<void> {
  if (!s) return;
  await endProcessesIn(s.root);
  fs.rmSync(s.root, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 });
}

// ---------------------------------------------------------------------------------------------
// Outside the stand-ins (DESK-DIST-INCL-002) — read only

/** The app's GUID as electron-builder makes it from the appId (its uninstall and install keys). */
function appGuid(): string {
  const require = createRequire(path.join(REPO, "package.json"));
  const { UUID } = require("builder-util-runtime") as {
    UUID: { v5(name: string, namespace: unknown): string; parse(s: string): unknown };
  };
  return UUID.v5("io.github.sharpwave.msfscareermap", UUID.parse("50e065bc-3134-11e6-9bab-38c9862bdaf3"));
}

let knownFolders: { documents: string; desktop: string; programs: string } | undefined;

/** Documents, the desktop and the Start menu's Programs folder, as Windows names them (read once). */
function shellFolders(): { documents: string; desktop: string; programs: string } {
  if (!knownFolders) {
    const r = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "[Environment]::GetFolderPath('MyDocuments'); [Environment]::GetFolderPath('Desktop'); [Environment]::GetFolderPath('Programs')",
      ],
      { encoding: "utf8", windowsHide: true },
    );
    const [documents, desktop, programs] = (r.stdout ?? "").split(/\r?\n/).map((l) => l.trim());
    if (!documents || !desktop || !programs) throw new Error(`could not read the known folders: ${r.stderr}`);
    knownFolders = { documents, desktop, programs };
  }
  return knownFolders;
}

/** A folder's files and folders, recursively, with sizes and times (and contents' hashes); "absent" when missing. */
function listing(folder: string, hashes = false): string {
  if (!fs.existsSync(folder)) return `${folder}: absent`;
  const lines: string[] = [`${folder}:`];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = win.join(dir, entry.name);
      const rel = win.relative(folder, p);
      if (entry.isDirectory()) {
        lines.push(`  ${rel}\\`);
        walk(p);
      } else {
        const st = fs.statSync(p);
        const hash = hashes ? ` ${crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex")}` : "";
        lines.push(`  ${rel} ${st.size} ${st.mtimeMs}${hash}`);
      }
    }
  };
  walk(folder);
  return lines.join("\n");
}

/** A file's size, time and hash, or "absent". */
function fileState(file: string): string {
  if (!fs.existsSync(file)) return `${file}: absent`;
  const st = fs.statSync(file);
  return `${file}: ${st.size} ${st.mtimeMs} ${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
}

/** `reg query` of a key (read only), or "absent". */
function regQuery(args: string[]): string {
  const r = spawnSync("reg.exe", ["query", ...args], { encoding: "utf8", windowsHide: true });
  return r.status === 0 ? `${args.join(" ")}:\n${r.stdout.trim()}` : `${args.join(" ")}: absent`;
}

/**
 * Snapshot of everything outside `s.root` an include test could touch: the real install folder,
 * download folder, data, backups and Electron folders' listings, the desktop and Start-menu shortcuts,
 * both MSFS editions' EXE.xml, HKCU's Run value, and HKCU's uninstall and install keys for the app.
 * Missing ones are recorded as absent. Reads only.
 */
export function outsideSnapshot(): string {
  const local = process.env.LOCALAPPDATA;
  const roaming = process.env.APPDATA;
  if (!local || !roaming) throw new Error("LOCALAPPDATA and APPDATA must be set");
  const known = shellFolders();
  const guid = appGuid();
  return [
    listing(win.join(local, "Programs", "MSFS Career Map")),
    listing(win.join(local, "msfs-career-map-updater")),
    listing(win.join(local, "MSFS Career Map")),
    listing(win.join(roaming, "MSFS Career Map")),
    listing(win.join(known.documents, "MSFS Career Map")),
    fileState(win.join(known.desktop, "MSFS Career Map.lnk")),
    fileState(win.join(known.programs, "MSFS Career Map.lnk")),
    fileState(win.join(local, "Packages", "Microsoft.Limitless_8wekyb3d8bbwe", "LocalCache", "EXE.xml")),
    fileState(win.join(roaming, "Microsoft Flight Simulator 2024", "EXE.xml")),
    regQuery([`HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${guid}`, "/s"]),
    regQuery([`HKCU\\Software\\${guid}`, "/s"]),
    regQuery(["HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "MSFS Career Map"]),
  ].join("\n");
}
