import { randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { APP_NAME } from "./version.ts";

/**
 * The data folder's lock: `career.db.lock`, holding the pid and port of the server that uses the
 * folder. It is created exclusively; a lock left by a server that is no longer there (or that is
 * not this app, or is on another folder) is taken over, and one held by a live server is refused.
 * Opens no database; a stale check asks the holder's own `/api/status` with the global fetch.
 */

/** In the data folder, whatever the database file is called. */
export const LOCK_FILE = "career.db.lock";

export interface LockInfo {
  pid: number;
  port: number;
}

export interface DataFolderLock {
  readonly file: string;
  /** Delete the lock while it still names this server's pid; harmless to call again. */
  release(): void;
}

export class FolderInUse extends Error {
  constructor(readonly holder: LockInfo) {
    super(`Another MSFS Career Map server (process ${holder.pid}, port ${holder.port}) is using this data folder`);
    this.name = "FolderInUse";
  }
}

/** How many times a stale lock is taken over before taking gives up. */
const MAX_TAKEOVERS = 3;
const DEFAULT_TIMEOUT_MS = 2000;

const lockText = (info: LockInfo) => `${JSON.stringify({ pid: info.pid, port: info.port })}\n`;

/** The lock's pid and port, or null for a file that is not a lock. */
function parseLock(text: string): LockInfo | null {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const { pid, port } = v as Record<string, unknown>;
  if (!Number.isInteger(pid) || (pid as number) <= 0) return null;
  if (!Number.isInteger(port) || (port as number) < 0 || (port as number) > 65535) return null;
  return { pid: pid as number, port: port as number };
}

/** The file's text, or null when there is none. */
function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

function removeFile(file: string): void {
  try {
    fs.unlinkSync(file);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
}

/**
 * Folders compared by their real paths, so a junction, a short name or a substituted drive leading
 * to the same folder is that folder; a path whose real path cannot be read is compared resolved.
 * Case-insensitively on Windows.
 */
function sameFolder(a: string, b: string): boolean {
  const norm = (p: string) => {
    let real: string;
    try {
      real = fs.realpathSync.native(p);
    } catch {
      real = path.resolve(p);
    }
    return process.platform === "win32" ? real.toLowerCase() : real;
  };
  return norm(a) === norm(b);
}

/** Whether a process with this pid runs; one under another account (EPERM) counts as running. */
function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Whether 127.0.0.1:`port` accepts a plain connection within the timeout; closed again at once. */
function accepts(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (ok: boolean) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

const isTimeout = (e: unknown) => e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");

/**
 * The holder a lock's text names when it is live. It is stale only on evidence that the holder is
 * gone or is not a server on this folder: this process's own pid, a dead process (judged without
 * asking), a port that refuses or closes the connection, or an answer naming another app, pid or
 * folder; a file that is not a lock is stale too. Anything else is live, a holder that accepts the
 * connection but has not answered in time included: a server busy on its main thread answers late.
 */
async function liveFrom(text: string, dataFolder: string, timeoutMs: number): Promise<LockInfo | null> {
  const info = parseLock(text);
  if (!info || info.pid === process.pid || !isRunning(info.pid)) return null;
  let res: Response;
  try {
    res = await fetch(`http://127.0.0.1:${info.port}/api/status`, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    // No answer in time: live when the port accepts connections, stale when nothing is there.
    if (isTimeout(e)) return (await accepts(info.port, timeoutMs)) ? info : null;
    return null;
  }
  try {
    if (res.status !== 200) return null;
    const st = (await res.json()) as { app?: unknown; pid?: unknown; dataFolder?: unknown };
    const live = st?.app === APP_NAME && st.pid === info.pid && typeof st.dataFolder === "string" && sameFolder(st.dataFolder, dataFolder);
    return live ? info : null;
  } catch (e) {
    // An answer begun but not finished in time is a holder still there; one that is not JSON is not this app.
    return isTimeout(e) ? info : null;
  }
}

/** The folder's lock holder when it is live, else null: no lock, an unreadable lock, or a stale one. */
// @spec APP-DATA-008
export async function liveHolder(dataFolder: string, o: { timeoutMs?: number } = {}): Promise<LockInfo | null> {
  const text = await readLock(path.join(dataFolder, LOCK_FILE));
  return text === null ? null : liveFrom(text, dataFolder, o.timeoutMs ?? DEFAULT_TIMEOUT_MS);
}

/** How long a lock that does not read as one is given before it is read again. */
const UNREADABLE_RETRY_MS = 100;

/**
 * The lock file's text, or null when there is none. A text that is not a lock is read once more
 * after a moment: a lock another server is creating is empty between its exclusive create and its
 * write.
 */
async function readLock(file: string): Promise<string | null> {
  const text = readText(file);
  if (text === null || parseLock(text)) return text;
  await new Promise((r) => setTimeout(r, UNREADABLE_RETRY_MS));
  return readText(file);
}

/** Codes a rename meets when another process got to the file first: gone, or being renamed or deleted (Windows). */
const LOST_RACE = new Set(["ENOENT", "EPERM", "EACCES", "EBUSY"]);

/**
 * Takes the lock for `me`, taking over a stale or unreadable one; throws FolderInUse when a live
 * server holds it. Every create is exclusive (`wx`). A stale lock is renamed to a name of this
 * process's own, and only the process that then holds the renamed file goes on: it deletes it when
 * it still holds the text judged, and creates the lock; a copy holding another text (a lock another
 * server has just taken) is put back with a link, which never overwrites, and the lock judged
 * again. At most three takeovers in all.
 */
// @spec APP-DATA-007, APP-DATA-008
export async function takeLock(dataFolder: string, me: LockInfo, o: { timeoutMs?: number } = {}): Promise<DataFolderLock> {
  const file = path.join(dataFolder, LOCK_FILE);
  const timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const keepsChanging = () => new Error(`cannot take ${file}: it keeps changing`);
  let takeovers = 0;
  for (;;) {
    try {
      fs.writeFileSync(file, lockText(me), { flag: "wx" });
      return lockFor(file, me);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }

    const text = await readLock(file);
    if (text !== null) {
      const holder = await liveFrom(text, dataFolder, timeoutMs);
      if (holder) throw new FolderInUse(holder);
    }
    if (takeovers >= MAX_TAKEOVERS) throw keepsChanging();
    takeovers++;
    // Gone already: create afresh.
    if (text === null) continue;

    const aside = `${file}.${process.pid}-${randomUUID()}`;
    try {
      fs.renameSync(file, aside);
    } catch (e) {
      // Another server renamed or deleted it first: create or judge afresh.
      if (LOST_RACE.has((e as NodeJS.ErrnoException).code ?? "")) continue;
      throw e;
    }
    const copied = readText(aside);
    // Moved on by another server's rename (Windows renames an open handle, so a second rename of
    // the same file can follow the first): that server holds it now; judge afresh.
    if (copied === null) continue;
    if (copied !== text) {
      // Rewritten by another server since it was read: put that lock back, never over a newer one.
      try {
        fs.linkSync(aside, file);
      } catch (e) {
        const code = (e as NodeJS.ErrnoException).code;
        if (code !== "EEXIST" && code !== "ENOENT") throw e;
      }
    }
    removeFile(aside);
  }
}

function lockFor(file: string, me: LockInfo): DataFolderLock {
  return {
    file,
    release() {
      const text = readText(file);
      if (text !== null && parseLock(text)?.pid === me.pid) removeFile(file);
    },
  };
}
