import fs from "node:fs";
import http, { type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { privateChannel, serveChannel, type PrivateChannel } from "./channel.ts";
import { InputError, readInputs, useInputs, type ServerForm, type ServerInputs } from "./inputs.ts";
import { FolderInUse, takeLock } from "./lock.ts";
import { installStopSignals, shutDown, shutdownBegun, type ShutdownParts } from "./shutdown.ts";
import { createStandIn } from "./standin.ts";
import { setStartup } from "./status.ts";
import type { Tracker } from "./tracker.ts";
import { startTracking } from "./tracking.ts";
import { VERSION } from "./version.ts";

/**
 * Starting the server as a process, for both entries (index.ts, a copy run from source, and
 * bundled.ts, the desktop app's): its inputs read, listening on 127.0.0.1 first with the start-up
 * stand-in answering, then the start-up work — the data folder, its lock, the database, the
 * tracker restored, the full app — then the airport data prepared and tracking started.
 *
 * Nothing that opens the database is imported here: db.ts, tracker.ts, app.ts and airports.ts are
 * loaded with import() once the inputs are set and the lock is taken, so a start that fails early,
 * or a server on another data folder, never opens the logbook in data/.
 */

export interface StartOptions {
  /** The bundled form: privateChannel(); a copy run from source: null. */
  channel: PrivateChannel | null;
  /** A copy run from source: true. */
  stopSignals: boolean;
  /** Default process.exit. */
  exit?: (code: number) => void;
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Reads the inputs, writing "Cannot start: …" and exiting 1 on an InputError, then startServer. */
// @spec APP-SRV-006, APP-SRV-007, APP-SRV-014
export async function runServer(form: ServerForm, argv: string[], env: NodeJS.ProcessEnv): Promise<void> {
  let inputs: ServerInputs;
  try {
    inputs = readInputs(form, argv, env);
  } catch (e) {
    if (!(e instanceof InputError)) throw e;
    console.error(e.message);
    process.exit(1);
  }
  // A copy run from source never opens a channel, even when its process has an IPC channel.
  await startServer(inputs, { channel: form === "bundled" ? privateChannel() : null, stopSignals: form === "source" });
}

/**
 * Listen on 127.0.0.1 with the stand-in, then do the start-up work step by step, switching to the
 * full app once it is done; then prepare the airport data and start tracking. A shutdown can come
 * at any step: each part goes to the shutdown order the moment it exists, a step is not begun once
 * a shutdown has, and a step that finishes after one has begun is disposed of here.
 */
// @spec APP-SRV-001, APP-SRV-005, APP-SRV-009, APP-SRV-011, APP-SRV-013, APP-SRV-014, APP-SRV-015, APP-SRV-016, APP-SRV-020, APP-SRV-021, APP-DATA-001
export async function startServer(inputs: ServerInputs, opts: StartOptions): Promise<void> {
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const parts: ShutdownParts = {};
  const begun = () => shutdownBegun(parts);
  /** Written to stderr as the reason, the last line before the exit. */
  const fail = (line: string) => {
    console.error(line);
    exit(1);
  };

  // 1. An error outside the request handlers ends the server at once: nothing saved, the lock kept.
  const fatal = (e: unknown) => {
    console.error("[server] stopping on an error outside the request handlers:", e);
    exit(1);
  };
  process.on("uncaughtException", fatal);
  process.on("unhandledRejection", fatal);

  // 2. The inputs, before anything that reads them loads; then the channel and the stop signals.
  useInputs(inputs);
  setStartup("opening");
  let restored: Tracker | null = null;
  if (opts.channel) {
    serveChannel(opts.channel, {
      // Before the tracker has restored there is nothing to save, and the answer goes out at once.
      save: () => restored?.saveNow(),
      shutdown: () => void shutDown(parts, { quitting: true, exit }),
    });
  }
  // Ctrl+C and the like leave casual mode as it is.
  if (opts.stopSignals) installStopSignals(() => void shutDown(parts, { quitting: false, exit }));

  // 3. Listen, on 127.0.0.1 alone and on the port asked for alone. Nothing in the data folder is
  // touched before this.
  let handler: RequestListener = createStandIn();
  const server = http.createServer({ requireHostHeader: false }, (req, res) => handler(req, res));
  const port = await new Promise<number | null>((resolve) => {
    const refused = (e: NodeJS.ErrnoException) => {
      if (e.code === "EADDRINUSE") {
        console.error(`Port ${inputs.port} is already in use`);
        exit(10);
      } else if (e.code === "EACCES") {
        console.error(`Windows refuses port ${inputs.port}`);
        exit(11);
      } else {
        fail(`Cannot start: cannot listen on port ${inputs.port}: ${e.message}`);
      }
      resolve(null);
    };
    server.once("error", refused);
    server.listen(inputs.port, "127.0.0.1", () => {
      server.off("error", refused);
      resolve((server.address() as AddressInfo).port);
    });
  });
  if (port === null) return;
  if (begun()) {
    server.close();
    return;
  }
  parts.http = server;

  // 4. The port actually bound, even when 0 was asked for.
  console.log(`[server] listening on http://127.0.0.1:${port}; data folder ${inputs.dataFolder}; sim ${inputs.sim}; version ${VERSION}`);

  // 6. The start-up work, in "opening" throughout. No step begins once a shutdown has.
  if (begun()) return;
  try {
    fs.mkdirSync(inputs.dataFolder, { recursive: true });
  } catch (e) {
    return fail(`Cannot start: cannot use the data folder ${inputs.dataFolder}: ${messageOf(e)}`);
  }

  if (begun()) return;
  let lock: Awaited<ReturnType<typeof takeLock>>;
  try {
    lock = await takeLock(inputs.dataFolder, { pid: process.pid, port });
  } catch (e) {
    // A live holder keeps its lock; the reason names it.
    if (e instanceof FolderInUse) return fail(e.message);
    return fail(`Cannot start: cannot use the data folder ${inputs.dataFolder}: ${messageOf(e)}`);
  }
  if (begun()) {
    lock.release();
    return;
  }
  parts.lock = lock;
  /** A failure once the lock is taken: the lock removed first, the reason the last line written. */
  const failHolding = (line: string) => {
    try {
      lock.release();
    } catch (e) {
      console.error("[server] could not remove the lock:", e);
    }
    fail(line);
  };

  // (1c: finish bringing in a logbook.)
  if (begun()) return;
  let database: typeof import("./db.ts");
  try {
    database = await import("./db.ts");
  } catch (e) {
    return failHolding(`Cannot start: cannot open the database ${inputs.dbPath}: ${messageOf(e)}`);
  }
  if (begun()) {
    try {
      database.db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {}
    try {
      database.db.close();
    } catch {}
    return;
  }
  parts.db = database.db;

  // (1c: a restored backup's icons, the logbook's id, the backup and the upgrade.)
  if (begun()) return;
  let tracking: typeof import("./tracker.ts");
  let createApp: typeof import("./app.ts").createApp;
  try {
    // Restores the tracker from its checkpoint, casual mode written off on a fresh run.
    tracking = await import("./tracker.ts");
    if (begun()) return;
    parts.tracker = tracking.tracker;
    restored = tracking.tracker;

    if (begun()) return;
    createApp = (await import("./app.ts")).createApp;
  } catch (e) {
    return failHolding(`Cannot start: ${messageOf(e)}`);
  }
  if (begun()) return;
  const app = createApp();
  setStartup("done");
  handler = app;
  console.log("[server] start-up done");

  // 7. The airport data; a failure is written out and the server goes on.
  if (begun()) return;
  const { ensureReferenceData } = await import("./airports.ts");
  try {
    await ensureReferenceData({ downloads: inputs.airportDownloads });
  } catch (e) {
    console.error(`[data] airport preparation failed: ${messageOf(e)}`);
  }
  if (begun()) return;
  console.log("[server] ready");

  // 8. Tracking, only now that the preparation has ended.
  parts.link = startTracking(tracking.tracker, { sim: inputs.sim, simHost: inputs.simHost, simPort: inputs.simPort });
}
