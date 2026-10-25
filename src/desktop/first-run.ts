import fs from "node:fs";
import path from "node:path";
import { APP_NAME } from "./version.ts";
import type { Cancel, Clock, HttpAnswer, LocalHttp } from "./ports.ts";

/** The port a copy run from source listens on. */
export const SOURCE_PORT = 3080;

const LOOK_MS = 500;

export interface FirstRunLook {
  /** The folder to offer the server (--offer); always equal to sourceFolder. */
  offer: string | null;
  /** What settings.sourceFolder becomes: the found folder when accepted; else the remembered one unless its check definitely failed; else null. */
  sourceFolder: string | null;
}

interface FolderChecks {
  isFixedDrive(letter: string): Promise<boolean>;
  isDirectory?(p: string): boolean;
  isFile?(p: string): boolean;
}

function statOf(p: string): fs.Stats | undefined {
  try {
    return fs.statSync(p, { throwIfNoEntry: false });
  } catch {
    return undefined;
  }
}

const isDirectoryOnDisk = (p: string) => statOf(p)?.isDirectory() ?? false;
const isFileOnDisk = (p: string) => statOf(p)?.isFile() ?? false;

/**
 * Whether a copy run from source's data folder can be offered: an absolute path on a drive letter
 * (no network or device path), on a fixed drive, an existing folder holding `career.db`.
 */
// @spec DESK-SHELL-FIRST-002
export async function acceptSourceFolder(folder: unknown, o: FolderChecks): Promise<boolean> {
  if (typeof folder !== "string" || !/^[A-Za-z]:[\\/]/.test(folder)) return false;
  const isDirectory = o.isDirectory ?? isDirectoryOnDisk;
  const isFile = o.isFile ?? isFileOnDisk;
  if (!isDirectory(folder) || !isFile(path.win32.join(folder, "career.db"))) return false;
  try {
    return (await o.isFixedDrive(folder[0].toUpperCase())) === true;
  } catch {
    return false;
  }
}

/** The data folder a status answer names, when it comes from this app run from source on a real sim or none. */
function detectedFolder(answer: HttpAnswer | null): string | null {
  if (answer === null || answer.status !== 200) return null;
  let json: unknown;
  try {
    json = JSON.parse(answer.body);
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const s = json as Record<string, unknown>;
  if (s.app !== APP_NAME || typeof s.dataFolder !== "string") return null;
  return s.sim === "link" || s.sim === "off" ? s.dataFolder : null;
}

const sameFolder = (a: string, b: string) => path.win32.resolve(a).toLowerCase() === path.win32.resolve(b).toLowerCase();

/**
 * The first run's look for a copy run from source: the ask of its status and the checks of the
 * folder found and of the one remembered run side by side, and the whole look ends when all have
 * settled or 500 ms after the call, whichever is first. A check still pending then is not an
 * acceptance; a remembered folder is dropped only by a check that failed. Never rejects.
 */
// @spec DESK-SHELL-FIRST-001, DESK-SHELL-FIRST-003, DESK-SHELL-FIRST-004, DESK-SHELL-SRV-004
export async function lookForSourceCopy(o: {
  http: LocalHttp;
  clock: Clock;
  remembered: string | null;
  isFixedDrive(letter: string): Promise<boolean>;
  isDirectory?(p: string): boolean;
  isFile?(p: string): boolean;
}): Promise<FirstRunLook> {
  const checks: FolderChecks = { isFixedDrive: o.isFixedDrive, isDirectory: o.isDirectory, isFile: o.isFile };
  const { remembered } = o;
  /** What has settled so far: the found folder once accepted, and whether the remembered one failed. */
  const settled: { accepted: string | null; rememberedFailed: boolean } = { accepted: null, rememberedFailed: false };

  // A check that throws is one that failed: the look itself never rejects.
  const rememberedCheck = remembered === null ? null : acceptSourceFolder(remembered, checks).catch(() => false);
  const rememberedLook = rememberedCheck?.then((ok) => {
    settled.rememberedFailed = !ok;
  });
  const foundLook = o.http
    .get(SOURCE_PORT, "/api/status", LOOK_MS)
    .then(async (answer) => {
      const folder = detectedFolder(answer);
      if (folder === null) return;
      const check = remembered !== null && rememberedCheck !== null && sameFolder(folder, remembered)
        ? rememberedCheck
        : acceptSourceFolder(folder, checks);
      if (await check) settled.accepted = folder;
    })
    .catch(() => {});

  let cancel: Cancel = () => {};
  const bound = new Promise<void>((resolve) => {
    cancel = o.clock.after(LOOK_MS, resolve);
  });
  await Promise.race([Promise.all([foundLook, rememberedLook]), bound]);
  cancel();

  const { accepted, rememberedFailed } = settled;
  if (accepted !== null) return { offer: accepted, sourceFolder: accepted };
  if (remembered !== null && !rememberedFailed) return { offer: remembered, sourceFolder: remembered };
  return { offer: null, sourceFolder: null };
}
