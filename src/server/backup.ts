import fs from "node:fs";
import path from "node:path";
import { backup as onlineBackup, DatabaseSync } from "node:sqlite";
import { documentsFolder } from "./documents.ts";
import type { BackupsInput } from "./inputs.ts";

/**
 * Backing the logbook up: SQLite's online backup of the open database into a temporary file, the
 * uploaded icons its aircraft name added as a `backup_icons` table, then the file given its name.
 * Names carry the UTC start time, the kind and the logbook's id; pruning goes by them. A failure has
 * a short reason in fixed words and a full one naming the folder and the error.
 */

/** `daily`, `quit`, `manual`, `update-<version>` or `upgrade-<version>`. */
export type BackupKind = string;

const NAME = /^career-(\d{8}T\d{6}Z)-(.+)-([0-9a-f]{16})\.db$/;

/** A time as `yyyyMMddTHHmmssZ`, in UTC. */
export function stamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

// @spec APP-BAK-004
export function backupFileName(start: Date, kind: BackupKind, logbookId: string): string {
  return `career-${stamp(start)}-${kind}-${logbookId}.db`;
}

/** A backup's name read back, or null for any other name. */
export function parseBackupName(name: string): { time: Date; kind: BackupKind; logbookId: string } | null {
  const m = NAME.exec(name);
  if (!m) return null;
  const t = m[1];
  const time = new Date(`${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(9, 11)}:${t.slice(11, 13)}:${t.slice(13, 15)}Z`);
  if (Number.isNaN(time.getTime())) return null;
  return { time, kind: m[2], logbookId: m[3] };
}

// ------------------------------------------------------------------ failures

export class BackupFailed extends Error {
  constructor(
    /** Fixed words by cause, naming no folder. */
    public short: string,
    /** "<short> — <folder>: <error message>". */
    public reason: string,
  ) {
    super(reason);
  }
}

/** The Documents folder is missing, or Windows cannot say where it is. */
export class DocumentsMissing extends Error {}

const REFUSED = "Windows refused the write (Controlled folder access?)";
const FULL = "the disk is full";
const NO_DOCUMENTS = "the Documents folder does not exist";
const OTHER = "the backup failed";

/** The two reasons for an error met while backing up into `folder`. */
// @spec APP-BAK-008
export function backupFailure(err: unknown, folder: string): BackupFailed {
  if (err instanceof BackupFailed) return err;
  const e = err as { code?: unknown; errcode?: unknown; message?: unknown };
  const message = err instanceof Error ? err.message : String(err);
  const short =
    err instanceof DocumentsMissing
      ? NO_DOCUMENTS
      : e?.code === "EPERM" || e?.code === "EACCES"
        ? REFUSED
        : e?.code === "ENOSPC" || e?.errcode === 13 || /disk is full/i.test(message)
          ? FULL
          : OTHER;
  return new BackupFailed(short, `${short} — ${folder}: ${message}`);
}

// ------------------------------------------------------------------ where

/** The backups folder: a literal path as given, or the path under Documents as Windows has it now. */
// @spec APP-BAK-006
export async function backupsFolder(input: BackupsInput): Promise<string> {
  if (input.kind === "folder") return input.folder;
  let docs: string;
  try {
    docs = await documentsFolder();
  } catch (e) {
    throw backupFailure(new DocumentsMissing(e instanceof Error ? e.message : String(e)), "Documents");
  }
  let isFolder = false;
  try {
    isFolder = fs.statSync(docs).isDirectory();
  } catch {
    isFolder = false;
  }
  if (!isFolder) throw backupFailure(new DocumentsMissing(`${docs} does not exist`), docs);
  return path.join(docs, input.path);
}

// ------------------------------------------------------------------ copying

/** The uploaded icon file an aircraft row's `icon` names, or null (a built-in icon). */
function iconFile(icon: unknown): string | null {
  const m = typeof icon === "string" ? /^\/images\/([^/?#\\]+)/.exec(icon) : null;
  return m && m[1] !== "." && m[1] !== ".." ? m[1] : null;
}

/**
 * Add a `backup_icons` table to the logbook file `file` holding each uploaded icon in `imagesDir`
 * its aircraft rows name; the table is kept (and added to) when the file already has one.
 */
export function addBackupIcons(file: string, imagesDir: string | null): void {
  const copy = new DatabaseSync(file);
  try {
    // One self-contained file: no write-ahead log beside it, even once it is read.
    copy.exec("PRAGMA journal_mode = DELETE");
    copy.exec(`CREATE TABLE IF NOT EXISTS backup_icons (file TEXT PRIMARY KEY, data BLOB NOT NULL)`);
    if (!imagesDir) return;
    const hasAircraft = copy.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'aircraft'`).get();
    if (!hasAircraft) return;
    const insert = copy.prepare(`INSERT OR REPLACE INTO backup_icons (file, data) VALUES (?, ?)`);
    for (const { icon } of copy.prepare(`SELECT icon FROM aircraft`).all() as { icon: unknown }[]) {
      const name = iconFile(icon);
      if (!name) continue;
      let data: Buffer;
      try {
        data = fs.readFileSync(path.join(imagesDir, name));
      } catch {
        continue; // named, but gone: nothing to carry
      }
      insert.run(name, data);
    }
  } finally {
    copy.close();
  }
}

export interface CopyOptions {
  /** The folder of the uploaded icons the logbook's aircraft name; null adds an empty table only. */
  imagesDir: string | null;
  onProgress?: () => void;
  signal?: AbortSignal;
}

/**
 * Copy the open logbook `db` with SQLite's online backup into `final` by way of `<final>.partial`,
 * with its icons; the temporary file is deleted when the copy fails or is abandoned.
 */
// @spec APP-BAK-003
export async function copyLogbook(db: DatabaseSync, final: string, o: CopyOptions): Promise<void> {
  const temp = `${final}.partial`;
  const abandoned = () => {
    if (o.signal?.aborted) throw new Error("the backup was abandoned");
  };
  try {
    abandoned();
    // A leftover from a run cut short; a folder standing there fails the copy.
    fs.rmSync(temp, { force: true });
    await onlineBackup(db, temp, {
      rate: 256,
      progress: () => {
        abandoned();
        o.onProgress?.();
      },
    });
    abandoned();
    addBackupIcons(temp, o.imagesDir);
    abandoned();
    fs.renameSync(temp, final);
  } catch (e) {
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      // not a file of ours
    }
    for (const side of ["-wal", "-shm", "-journal"]) {
      try {
        fs.rmSync(temp + side, { force: true });
      } catch {
        // gone already
      }
    }
    throw e;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface BackupOptions extends CopyOptions {
  folder: string;
  kind: BackupKind;
  logbookId: string;
}

/**
 * Back the logbook up into `folder` (created with its parents) as a named backup, waiting for the
 * next second while the name is taken, then prune that logbook's backups there. Returns the full
 * path; throws BackupFailed.
 */
// @spec APP-BAK-003, APP-BAK-004, APP-BAK-007
export async function takeBackup(db: DatabaseSync, o: BackupOptions): Promise<string> {
  try {
    fs.mkdirSync(o.folder, { recursive: true });
    let final: string;
    for (;;) {
      const start = new Date();
      final = path.join(o.folder, backupFileName(start, o.kind, o.logbookId));
      if (!fs.existsSync(final)) break;
      await sleep(1000 - start.getMilliseconds() + 5);
    }
    await copyLogbook(db, final, o);
    pruneBackups(o.folder, o.logbookId);
    console.log(`[backup] ${final}`);
    return final;
  } catch (e) {
    throw backupFailure(e, o.folder);
  }
}

// ------------------------------------------------------------------ pruning

const DAILY_KEPT = 7;
const OTHERS_KEPT = 3;

/**
 * Of `folder`'s backups of logbook `logbookId`: the daily ones beyond the seven newest, and the
 * others beyond the three newest (the newest upgrade backup kept outside that count), deleted.
 * Manual backups, other logbooks' backups and any other file are left alone.
 */
// @spec APP-BAK-007
export function pruneBackups(folder: string, logbookId: string): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(folder);
  } catch {
    return [];
  }
  const mine = names
    .map((name) => ({ name, parsed: parseBackupName(name) }))
    .filter((b) => b.parsed?.logbookId === logbookId)
    .sort((a, b) => b.parsed!.time.getTime() - a.parsed!.time.getTime() || b.name.localeCompare(a.name));
  const daily = mine.filter((b) => b.parsed!.kind === "daily");
  const newestUpgrade = mine.find((b) => b.parsed!.kind.startsWith("upgrade-"));
  const others = mine.filter((b) => b.parsed!.kind !== "daily" && b.parsed!.kind !== "manual" && b !== newestUpgrade);
  const doomed = [...daily.slice(DAILY_KEPT), ...others.slice(OTHERS_KEPT)].map((b) => b.name);
  for (const name of doomed) {
    try {
      fs.rmSync(path.join(folder, name), { force: true });
    } catch (e) {
      console.error(`[backup] could not delete the old backup ${name}:`, e);
    }
  }
  return doomed;
}

// ------------------------------------------------------------------ the fallback

export interface FallbackOptions extends CopyOptions {
  backups: BackupsInput;
  dataFolder: string;
  /** `update-<version>` or `upgrade-<version>`. */
  kind: BackupKind;
  logbookId: string;
}

/**
 * A backup before an update or an upgrade: into the backups folder, or, when that cannot be written,
 * into the data folder as `career.before-update-V.db` or `career.before-V.db`, the earlier one of
 * that pattern deleted once it is done. Throws the data folder's failure when both fail.
 */
// @spec APP-BAK-009
export async function backupWithFallback(db: DatabaseSync, o: FallbackOptions): Promise<string> {
  try {
    const folder = await backupsFolder(o.backups);
    return await takeBackup(db, { ...o, folder });
  } catch (e) {
    if (!(e instanceof BackupFailed) || o.signal?.aborted) throw e;
    const update = o.kind.startsWith("update-");
    const version = o.kind.replace(/^(update|upgrade)-/, "");
    const name = update ? `career.before-update-${version}.db` : `career.before-${version}.db`;
    const final = path.join(o.dataFolder, name);
    try {
      fs.mkdirSync(o.dataFolder, { recursive: true });
      await copyLogbook(db, final, o);
    } catch (e2) {
      throw backupFailure(e2, o.dataFolder);
    }
    const same = update ? /^career\.before-update-.+\.db$/ : /^career\.before-(?!update-|import-).+\.db$/;
    for (const other of fs.readdirSync(o.dataFolder)) {
      if (other === name || !same.test(other)) continue;
      try {
        fs.rmSync(path.join(o.dataFolder, other), { force: true });
      } catch (err) {
        console.error(`[backup] could not delete the earlier ${other}:`, err);
      }
    }
    console.error(`[backup] ${e.reason}; took it into the data folder instead: ${final}`);
    return final;
  }
}
