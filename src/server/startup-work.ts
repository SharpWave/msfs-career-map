import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BackupFailed, backupWithFallback, stamp } from "./backup.ts";
import type { BackupsInput } from "./inputs.ts";
import { readLogbookId, writeNewLogbookId } from "./logbook-id.ts";
import { INCOMING, INCOMING_MARK, type ImportOutcome } from "./incoming.ts";
import { applySchema, holdsAppTables, upgradeNeeded } from "./schema.ts";
import type { StartupStep } from "./status.ts";

/**
 * The start-up work on the logbook, run in a worker thread with a connection of its own
 * (startup-worker.ts) so the server's event loop stays free, and in process by the tests: finishing a
 * logbook brought in, opening the logbook (recovering its write-ahead log), putting a restored
 * backup's icons in place, giving it its id, and backing it up before an upgrade.
 */

export interface StartupWorkOptions {
  dataFolder: string;
  dbPath: string;
  backups: BackupsInput;
  /** The server's own version: the backup before an upgrade is `upgrade-<version>`. */
  version: string;
  now?: () => Date;
  signal?: AbortSignal;
}

export interface StartupWorkResult {
  logbookId: string;
  outcome: ImportOutcome | null;
}

/** The start cannot go on: its line is the last the server writes before exiting 1. */
export class StartupFailed extends Error {
  constructor(public line: string) {
    super(line);
  }
}

const exists = (p: string) => fs.existsSync(p);
const remove = (p: string) => {
  try {
    fs.rmSync(p, { force: true });
  } catch {
    // a folder, or held: nothing of ours
  }
};

/**
 * A copy waiting beside the database: discarded when not marked complete, or when the logbook in use
 * holds hops by now (counted with its write-ahead log, then checkpointed and closed); otherwise
 * swapped in, each step a rename — the log files aside, the database aside, the copy into place.
 */
// @spec APP-IMP-004, APP-IMP-005
function finishImport(o: StartupWorkOptions, report: (s: StartupStep) => void, now: () => Date): ImportOutcome | null {
  const incoming = path.join(o.dataFolder, INCOMING);
  const mark = path.join(o.dataFolder, INCOMING_MARK);
  if (!exists(incoming) && !exists(mark)) return null;
  let complete = false;
  try {
    complete = JSON.parse(fs.readFileSync(mark, "utf8"))?.complete === true;
  } catch {
    complete = false;
  }
  if (!complete || !exists(incoming)) {
    for (const f of [incoming, `${incoming}-wal`, `${incoming}-shm`, mark]) remove(f);
    return null;
  }

  report("bringing-in");
  console.log("[server] bringing in a logbook");
  const at = now();
  const db = o.dbPath;
  const wal = `${db}-wal`;
  const shm = `${db}-shm`;
  if (exists(db)) {
    let hops = 0;
    const current = new DatabaseSync(db);
    try {
      const hasHops = current.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'hops'`).get();
      if (hasHops) hops = (current.prepare(`SELECT COUNT(*) AS n FROM hops`).get() as { n: number }).n;
      current.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } finally {
      current.close();
    }
    if (hops > 0) {
      for (const f of [incoming, mark]) remove(f);
      console.log("[server] did not bring the logbook in: the logbook here held hops by then");
      return { outcome: "not-brought-in", reason: "the logbook here held hops by then", at: at.toISOString() };
    }
  }
  if (exists(db) || exists(wal) || exists(shm)) {
    const aside = path.join(o.dataFolder, `career.before-import-${stamp(at)}.db`);
    if (exists(wal)) fs.renameSync(wal, `${aside}-wal`);
    if (exists(shm)) fs.renameSync(shm, `${aside}-shm`);
    if (exists(db)) fs.renameSync(db, aside);
  }
  fs.renameSync(incoming, db);
  remove(mark);
  console.log("[server] brought the logbook in");
  return { outcome: "brought-in", at: at.toISOString() };
}

/**
 * A restored backup — a logbook holding `backup_icons`, one brought in among them: the data folder's
 * `images` moved aside, the table's icons written to a new `images`, then a new id and the table
 * dropped in one transaction. A start cut short before the drop does it all again.
 */
// @spec APP-BAK-011
export function restoreIcons(db: DatabaseSync, dataFolder: string, now: Date): void {
  const images = path.join(dataFolder, "images");
  if (exists(images)) {
    let aside = path.join(dataFolder, `images.before-restore-${stamp(now)}`);
    for (let n = 2; exists(aside); n++) aside = path.join(dataFolder, `images.before-restore-${stamp(now)}-${n}`);
    fs.renameSync(images, aside);
  }
  fs.mkdirSync(images, { recursive: true });
  for (const { file, data } of db.prepare(`SELECT file, data FROM backup_icons`).all() as { file: string; data: Uint8Array }[]) {
    const name = path.basename(String(file));
    if (!name || name === "." || name === "..") continue;
    fs.writeFileSync(path.join(images, name), data);
  }
  db.exec("BEGIN");
  try {
    writeNewLogbookId(db);
    db.exec("DROP TABLE backup_icons");
    db.exec("COMMIT");
  } catch (e) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // rolled back already
    }
    throw e;
  }
}

/** Run the start-up work, reporting each step; the logbook's id and an import's outcome. */
// @spec APP-SRV-001, APP-SRV-010, APP-DATA-004, APP-DATA-006, APP-BAK-010
export async function runStartupWork(o: StartupWorkOptions, report: (step: StartupStep) => void): Promise<StartupWorkResult> {
  const now = o.now ?? (() => new Date());
  const outcome = finishImport(o, report, now);

  report("opening");
  const db = new DatabaseSync(o.dbPath);
  try {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");

    // A new database: its tables, then its id.
    if (!holdsAppTables(db)) {
      applySchema(db);
      const logbookId = readLogbookId(db) ?? writeNewLogbookId(db);
      return { logbookId, outcome };
    }

    const restored = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'backup_icons'`).get();
    if (restored) restoreIcons(db, o.dataFolder, now());
    const logbookId = readLogbookId(db) ?? writeNewLogbookId(db);

    if (upgradeNeeded(db)) {
      report("backing-up");
      console.log("[server] backing up the logbook before upgrading it");
      try {
        await backupWithFallback(db, {
          backups: o.backups,
          dataFolder: o.dataFolder,
          kind: `upgrade-${o.version}`,
          logbookId,
          imagesDir: path.join(o.dataFolder, "images"),
          signal: o.signal,
        });
      } catch (e) {
        if (e instanceof BackupFailed) throw new StartupFailed(`Could not back up the logbook before upgrading it: ${e.reason}`);
        throw e;
      }
      report("upgrading");
      console.log("[server] upgrading the logbook");
      applySchema(db);
    }
    return { logbookId, outcome };
  } finally {
    try {
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {
      // closing checkpoints too
    }
    db.close();
  }
}
