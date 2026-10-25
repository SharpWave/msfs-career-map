/**
 * The server's shutdown order, and the stop signals that start it for a copy run from source. The
 * order reads each part of the server when it reaches that part's step, so a part the start-up
 * gives it while it runs is still shut down, and a part never reached is skipped.
 */

export interface ShutdownParts {
  /** The Tracking from startTracking, once started. */
  link?: { stop(): void } | null;
  /** Once restored. */
  tracker?: { shutdown(o: { quitting: boolean }): void } | null;
  /** Once listening. */
  http?: { closeAllConnections(): void; close(cb?: (err?: Error) => void): unknown } | null;
  /** The server's own database connection, once open. */
  db?: { exec(sql: string): void; close(): void } | null;
  /** Once taken. */
  lock?: { release(): void } | null;
}

export interface ShutdownOptions {
  quitting: boolean;
  exit: (code: number) => void;
  /** Default 5000: exit 0 by then whatever the steps are still waiting for. */
  deadlineMs?: number;
}

const DEFAULT_DEADLINE_MS = 5000;

/** Each parts object's shutdown, once begun: a second call gets the first one's promise. */
const begun = new WeakMap<ShutdownParts, Promise<void>>();

/** A step that throws is written out, and the order goes on. */
function attempt(what: string, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    console.error(`[server] shutting down: ${what} failed:`, e);
  }
}

/** Closing the server, awaited until it has closed; one that throws is not waited for. */
function closeServer(http: NonNullable<ShutdownParts["http"]>): Promise<void> {
  return new Promise<void>((resolve) => {
    try {
      http.close((err) => {
        if (err) console.error("[server] shutting down: closing the server failed:", err);
        resolve();
      });
    } catch (e) {
      console.error("[server] shutting down: closing the server failed:", e);
      resolve();
    }
  });
}

/**
 * Shut the server down, in this order: stop the sim link (so nothing more reaches the tracker),
 * the tracker's final checkpoint (casual mode off when quitting), every open connection and event
 * stream ended, the server closed and waited for, the database checkpointed and closed, the lock
 * removed, then exit 0. Exits 0 at the deadline if the steps have not finished by then, and exits
 * exactly once for each parts object. A plain function: a second call with the same parts returns
 * the very same promise, running nothing again.
 */
// @spec APP-SRV-016, LIVE-LINK-011, LIVE-SAVE-005, LIVE-CASUAL-013
export function shutDown(parts: ShutdownParts, o: ShutdownOptions): Promise<void> {
  const running = begun.get(parts);
  if (running) return running;

  console.log("[server] shutting down");
  let exited = false;
  const exitOnce = () => {
    if (exited) return;
    exited = true;
    clearTimeout(deadline);
    o.exit(0);
  };
  const deadline = setTimeout(exitOnce, o.deadlineMs ?? DEFAULT_DEADLINE_MS);

  const steps = async () => {
    const link = parts.link;
    if (link) attempt("stopping the sim link", () => link.stop());
    const tracker = parts.tracker;
    if (tracker) attempt("the tracker's final checkpoint", () => tracker.shutdown({ quitting: o.quitting }));
    // (Later milestones: stop the airport work; abandon a backup or a copy, finish a swap, roll back an upgrade.)
    const http = parts.http;
    if (http) {
      attempt("ending the open connections", () => http.closeAllConnections());
      await closeServer(http);
    }
    const db = parts.db;
    if (db) {
      attempt("checkpointing the database", () => db.exec("PRAGMA wal_checkpoint(TRUNCATE)"));
      attempt("closing the database", () => db.close());
    }
    const lock = parts.lock;
    if (lock) attempt("removing the lock", () => lock.release());
    exitOnce();
  };
  // Registered before any step runs, so a call made from inside a step gets this same promise.
  const p = Promise.resolve().then(steps);
  begun.set(parts, p);
  return p;
}

/** True from the first shutDown(parts, …) on, for that parts object. */
export function shutdownBegun(parts: ShutdownParts): boolean {
  return begun.has(parts);
}

const STOP_SIGNALS = ["SIGINT", "SIGBREAK", "SIGHUP", "SIGTERM"] as const;

/**
 * One listener on `target` for each of SIGINT, SIGBREAK, SIGHUP and SIGTERM (Ctrl+C, Ctrl+Break,
 * the console window closed, a polite kill), each calling `onStop`. Returns the uninstall.
 */
// @spec APP-SRV-018
export function installStopSignals(onStop: () => void, target: NodeJS.EventEmitter = process): () => void {
  const listener = () => onStop();
  for (const sig of STOP_SIGNALS) target.on(sig, listener);
  return () => {
    for (const sig of STOP_SIGNALS) target.removeListener(sig, listener);
  };
}
