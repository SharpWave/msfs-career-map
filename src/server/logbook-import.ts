import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { backupQueue } from "./backup-service.ts";
import { backupsFolder, copyLogbook, parseBackupName } from "./backup.ts";
import { INCOMING, INCOMING_MARK, type ImportOutcome } from "./incoming.ts";
import { currentInputs } from "./inputs.ts";
import { liveHolder } from "./lock.ts";
import { serverStatus } from "./status.ts";

/**
 * Bringing in a logbook from another data folder or a backup, into a logbook that holds no hops:
 * what is offered, the request's checks, and the copy made ready beside the database with the merged
 * tracker state, marked complete for the next start to swap in (startup-work.ts). The database and
 * tracker modules are loaded only when a request comes, so the server can set this up before its
 * start-up work is done.
 */

/** A refusal: its status and reason. */
export class ImportRefused extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let lastAttempt: ImportOutcome | null = null;
let finish: (o: { restart: "automatic" | "manual" }) => void = () => {};
let restart: "automatic" | "manual" = "manual";
let tracking: { pause(): void; resume(): void } | null = null;
/** The copy under way (its paths), from the acceptance until the answer or a failure. */
let underWay: { partial: string; incoming: string; mark: string; done: boolean } | null = null;

/** The outcome the start-up work found, kept until the next attempt. */
// @spec APP-IMP-005
export function setLastAttempt(o: ImportOutcome | null): void {
  lastAttempt = o;
}

/**
 * What runs once an accepted copy has been answered: the server's shutdown with exit code 12. Test
 * servers leave it to the test (APP-SRV-023).
 */
export function setImportFinish(fn: (o: { restart: "automatic" | "manual" }) => void): void {
  finish = fn;
}

/** Whether a server started again by itself after the exit (a private channel): what the answer says. */
export function setImportRestart(r: "automatic" | "manual"): void {
  restart = r;
}

/** The server's tracking, paused while the copy is made and resumed when it fails. */
export function setImportTracking(t: { pause(): void; resume(): void } | null): void {
  tracking = t;
}

/** At shutdown: a copy still being made is deleted; a complete one waits for the next start. */
// @spec APP-SRV-016
export function abandonImport(): void {
  const u = underWay;
  if (!u || u.done) return;
  for (const f of [u.partial, u.incoming, u.mark]) {
    try {
      fs.rmSync(f, { force: true });
    } catch {
      // held or a folder: left for the next start, which deletes a copy not marked complete
    }
  }
}

// ------------------------------------------------------------------ reading other logbooks

interface LogbookSummary {
  hops: number;
  newestHop: string | null;
  checkpoint: string | null;
}

/** A logbook file's hop count, newest hop and checkpoint text, read without changing it; null when it cannot be read. */
function summarise(file: string): LogbookSummary | null {
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const tables = new Set((db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map((r) => r.name));
    let hops = 0;
    let newestHop: string | null = null;
    if (tables.has("hops")) {
      const r = db.prepare(`SELECT COUNT(*) AS n, MAX(COALESCE(arrived_at, departed_at)) AS newest FROM hops`).get() as { n: number; newest: string | null };
      hops = r.n;
      newestHop = r.newest;
    }
    const cp = tables.has("tracker_state") ? (db.prepare(`SELECT json FROM tracker_state WHERE id = 1`).get() as { json: string } | undefined) : undefined;
    return { hops, newestHop, checkpoint: cp?.json ?? null };
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

const realFolder = (p: string): string | null => {
  try {
    return fs.realpathSync.native(p).toLowerCase();
  } catch {
    return null;
  }
};

async function ownCounts(): Promise<{ hops: number; aircraft: number }> {
  const { db } = await import("./db.ts");
  const hops = (db.prepare(`SELECT COUNT(*) AS n FROM hops`).get() as { n: number }).n;
  const aircraft = (db.prepare(`SELECT COUNT(*) AS n FROM aircraft`).get() as { n: number }).n;
  return { hops, aircraft };
}

// ------------------------------------------------------------------ the offer

export type Offered =
  | { kind: "folder"; folder: string; hops: number; newestHop: string | null }
  | { kind: "backup"; file: string; time: string; hops: number; newestHop: string | null };

/**
 * What can be brought in, worked out now: while the logbook here holds no hops, the logbook to offer
 * when it holds `career.db`, and the newest backup of each other logbook whose logbook holds hops.
 */
// @spec APP-IMP-001, APP-IMP-005
export async function offer(): Promise<{ hops: number; aircraft: number; offers: Offered[]; lastAttempt: ImportOutcome | null }> {
  const { hops, aircraft } = await ownCounts();
  const offers: Offered[] = [];
  if (hops === 0) {
    const inputs = currentInputs();
    const folder = inputs.offer;
    if (folder && realFolder(folder) !== realFolder(inputs.dataFolder) && fs.existsSync(path.join(folder, "career.db"))) {
      const s = summarise(path.join(folder, "career.db"));
      if (s) offers.push({ kind: "folder", folder, hops: s.hops, newestHop: s.newestHop });
    }
    let backups: string | null = null;
    try {
      backups = await backupsFolder(inputs.backups);
    } catch {
      backups = null; // Documents missing: nothing to offer from it
    }
    const own = serverStatus().logbookId;
    const newest = new Map<string, { file: string; time: Date }>();
    for (const file of backups && fs.existsSync(backups) ? fs.readdirSync(backups) : []) {
      const b = parseBackupName(file);
      if (!b || b.logbookId === own) continue;
      const cur = newest.get(b.logbookId);
      if (!cur || b.time > cur.time) newest.set(b.logbookId, { file, time: b.time });
    }
    const found: Offered[] = [];
    for (const { file, time } of newest.values()) {
      const s = summarise(path.join(backups!, file));
      if (s && s.hops > 0) found.push({ kind: "backup", file, time: time.toISOString(), hops: s.hops, newestHop: s.newestHop });
    }
    found.sort((a, b) => ((b as { time: string }).time ?? "").localeCompare((a as { time: string }).time ?? ""));
    offers.push(...found);
  }
  return { hops, aircraft, offers, lastAttempt };
}

// ------------------------------------------------------------------ the request

const refuse = (message: string) => new ImportRefused(409, message);

/**
 * Bring in the logbook a request names (`{folder}` or `{backup}`): checked, then — tracking paused
 * and backups held — copied beside the database with its icons and the merged tracker state, and
 * marked complete. Resolves with what to answer (202); `answered` is called once the answer is out.
 * Throws ImportRefused for a refusal; any other failure deletes the copy, resumes tracking and
 * releases the backups before it propagates.
 */
// @spec APP-IMP-002, APP-IMP-003
export async function bringIn(body: unknown): Promise<{ restart: "automatic" | "manual"; answered: () => void }> {
  const b = (typeof body === "object" && body !== null ? body : {}) as { folder?: unknown; backup?: unknown };
  const hasFolder = typeof b.folder === "string" && b.folder !== "";
  const hasBackup = typeof b.backup === "string" && b.backup !== "";
  if (hasFolder === hasBackup) throw new ImportRefused(400, "name a folder or a backup to bring in");
  if (underWay) throw refuse("A logbook is already being brought in");

  const inputs = currentInputs();
  if ((await ownCounts()).hops > 0) throw refuse("This logbook already holds hops");

  let source: string;
  let imagesDir: string | null;
  if (hasFolder) {
    const folder = path.resolve(b.folder as string);
    const real = realFolder(folder);
    if (real !== null && real === realFolder(inputs.dataFolder)) throw refuse("That is the logbook in use");
    source = path.join(folder, "career.db");
    if (!fs.existsSync(source)) throw refuse("No logbook there");
    if (await liveHolder(folder)) throw refuse("Close the MSFS Career Map running on that folder first");
    imagesDir = path.join(folder, "images");
  } else {
    const name = b.backup as string;
    let folder: string | null = null;
    try {
      folder = await backupsFolder(inputs.backups);
    } catch {
      folder = null;
    }
    if (!folder || !parseBackupName(name) || path.basename(name) !== name || !fs.existsSync(path.join(folder, name))) throw refuse("No logbook there");
    source = path.join(folder, name);
    imagesDir = null; // a backup carries its own icons
  }

  const { checkpointProblem, tracker } = await import("./tracker.ts");
  const summary = summarise(source);
  if (!summary) throw refuse("No logbook there");
  if (checkpointProblem(summary.checkpoint)) {
    throw refuse("Log or discard its waiting legs in the other copy first, or update MSFS Career Map");
  }

  // Accepted: tracking paused, backups held, the copy made.
  const incoming = path.join(inputs.dataFolder, INCOMING);
  const u = { partial: `${incoming}.partial`, incoming, mark: path.join(inputs.dataFolder, INCOMING_MARK), done: false };
  underWay = u;
  tracker.pauseForImport();
  tracking?.pause();
  backupQueue.hold("import");
  console.log(`[server] bringing in the logbook ${source}`);
  try {
    for (const f of [u.incoming, u.mark]) fs.rmSync(f, { force: true });
    const src = new DatabaseSync(source, { readOnly: true });
    try {
      await copyLogbook(src, incoming, { imagesDir });
    } finally {
      src.close();
    }
    const copy = new DatabaseSync(incoming);
    try {
      tracker.writeMergedCheckpoint(copy, summary.checkpoint);
    } finally {
      copy.close();
    }
    fs.writeFileSync(u.mark, JSON.stringify({ complete: true, from: source, at: new Date().toISOString() }));
    u.done = true;
  } catch (e) {
    abandonImport();
    underWay = null;
    tracker.resumeAfterImport();
    tracking?.resume();
    backupQueue.release("import");
    throw e;
  }
  const r = restart;
  return { restart: r, answered: () => finish({ restart: r }) };
}
