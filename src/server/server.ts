import fs from "node:fs";
import http, { type RequestListener } from "node:http";
import type { AddressInfo } from "node:net";
import { privateChannel, serveChannel, type PrivateChannel } from "./channel.ts";
import { InputError, readInputs, useInputs, type ServerForm, type ServerInputs } from "./inputs.ts";
import { FolderInUse, takeLock } from "./lock.ts";
import { installStopSignals, shutDown, shutdownBegun, type ShutdownParts } from "./shutdown.ts";
import { createStandIn } from "./standin.ts";
import { setLogbookId, setStartup, type StartupStep } from "./status.ts";
import { Worker } from "node:worker_threads";
import { backupQueue } from "./backup-service.ts";
import { abandonImport, setImportFinish, setImportRestart, setImportTracking, setLastAttempt } from "./logbook-import.ts";
import { StartupFailed, type StartupWorkOptions, type StartupWorkResult } from "./startup-work.ts";
import type { Tracker } from "./tracker.ts";
import { pilotInSim, startTracking } from "./tracking.ts";
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
// @spec APP-SRV-001, APP-SRV-005, APP-SRV-009, APP-SRV-011, APP-SRV-012, APP-SRV-013, APP-SRV-014, APP-SRV-015, APP-SRV-016, APP-SRV-020, APP-SRV-021, APP-DATA-001
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
  // Backups asked for during the start-up work wait for it; an unfinished one is abandoned at shutdown.
  backupQueue.hold("start");
  parts.backups = backupQueue;
  parts.importCopy = { abandon: abandonImport };
  let restored: Tracker | null = null;
  if (opts.channel) {
    serveChannel(opts.channel, {
      // Before the tracker has restored there is nothing to save, and the answer goes out at once.
      save: () => restored?.saveNow(),
      shutdown: () => void shutDown(parts, { quitting: true, exit }),
      backup: (kind, onProgress) => backupQueue.request(kind, onProgress),
    });
  }
  // A logbook brought in: the server shuts down, casual mode as it is, and exits 12 to be started again.
  setImportRestart(opts.channel ? "automatic" : "manual");
  setImportFinish(() => void shutDown(parts, { quitting: false, exit: () => exit(12) }));
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

  // The start-up work on the logbook, off the event loop: an import finished, the logbook opened,
  // its icons and id, its backup and upgrade. Then the modules holding the server's own connection.
  if (begun()) return;
  let work: StartupWorkResult;
  try {
    const worker = runStartupWorker({
      dataFolder: inputs.dataFolder,
      dbPath: inputs.dbPath,
      backups: inputs.backups,
      version: VERSION,
    });
    parts.startupWork = worker;
    work = await worker.done;
  } catch (e) {
    if (begun()) return;
    if (e instanceof StartupFailed) return failHolding(e.line);
    return failHolding(`Cannot start: cannot open the database ${inputs.dbPath}: ${messageOf(e)}`);
  } finally {
    parts.startupWork = null;
  }
  if (begun()) return;
  setLogbookId(work.logbookId);
  if (work.outcome) setLastAttempt(work.outcome);
  setStartup("opening");

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
  backupQueue.release("start");

  // 7. The airport data; a failure is written out and the server goes on.
  if (begun()) return;
  const { airportWork } = await import("./airports.ts");
  parts.airportWork = airportWork;
  try {
    await airportWork.prepareAtStart({ downloads: inputs.airportDownloads });
  } catch (e) {
    if (!begun()) console.error(`[data] airport preparation failed: ${messageOf(e)}`);
  }
  if (begun()) return;
  console.log("[server] ready");

  // 8. Tracking, only now that the preparation has ended.
  // The sim-link claim names this server the installed app when bundled, a copy run from source otherwise.
  const live = startTracking(tracking.tracker, {
    sim: inputs.sim,
    simHost: inputs.simHost,
    simPort: inputs.simPort,
    holder: inputs.form === "bundled" ? "installed" : "source",
    dataFolder: inputs.dataFolder,
  });
  parts.link = live;
  setImportTracking(live);

  // 9. The daily airport checks, held while the pilot is in the sim.
  airportWork.startChecks(pilotInSim(tracking.tracker));
}

/**
 * The start-up work in a worker thread with its own database connection (startup-worker.ts), its
 * steps reported in the status. `stop()` ends it at shutdown: a swap of a logbook brought in is let
 * finish, anything else is stopped where it is — an upgrade under way rolls back, being one
 * transaction — and an unfinished backup's file is deleted.
 */
// @spec APP-SRV-010, APP-SRV-016
function runStartupWorker(o: StartupWorkOptions): { done: Promise<StartupWorkResult>; stop(): Promise<void> } {
  const worker = new Worker(new URL("./startup-worker.ts", import.meta.url), { workerData: o });
  let step: StartupStep = "opening";
  const done = new Promise<StartupWorkResult>((resolve, reject) => {
    worker.on("message", (m: { type: string; step?: StartupStep; logbookId?: string; outcome?: StartupWorkResult["outcome"]; line?: string; message?: string }) => {
      if (m.type === "step" && m.step) {
        step = m.step;
        setStartup(m.step);
      } else if (m.type === "done") resolve({ logbookId: m.logbookId!, outcome: m.outcome ?? null });
      else if (m.type === "failed") reject(new StartupFailed(m.line!));
      else if (m.type === "error") reject(new Error(m.message));
    });
    worker.on("error", reject);
    worker.on("exit", (code) => reject(new Error(`the start-up work ended with code ${code}`)));
  });
  done.catch(() => {});
  return {
    done,
    async stop() {
      if (step === "bringing-in") await Promise.race([done.catch(() => {}), new Promise((r) => setTimeout(r, 3000))]);
      await worker.terminate();
      // An unfinished backup the worker was writing.
      const folders = [o.dataFolder, ...(o.backups.kind === "folder" ? [o.backups.folder] : [])];
      for (const folder of folders) {
        let names: string[] = [];
        try {
          names = fs.readdirSync(folder);
        } catch {
          continue;
        }
        for (const name of names) {
          if (!/^career[-.].*\.db\.partial(-wal|-shm|-journal)?$/.test(name) || name.startsWith("career.db.incoming")) continue;
          try {
            fs.rmSync(`${folder}/${name}`, { force: true });
          } catch {
            // not a file of ours
          }
        }
      }
    },
  };
}
