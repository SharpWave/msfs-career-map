import { parentPort, workerData } from "node:worker_threads";
import { StartupFailed, runStartupWork, type StartupWorkOptions } from "./startup-work.ts";

/**
 * The start-up work's worker thread: runs it on its own database connection and tells the server
 * each step, then the logbook's id and an import's outcome, or why it could not start.
 */
// @spec APP-SRV-010
const port = parentPort!;
runStartupWork(workerData as StartupWorkOptions, (step) => port.postMessage({ type: "step", step })).then(
  (r) => port.postMessage({ type: "done", logbookId: r.logbookId, outcome: r.outcome }),
  (e: unknown) =>
    port.postMessage(
      e instanceof StartupFailed ? { type: "failed", line: e.line } : { type: "error", message: e instanceof Error ? e.message : String(e) },
    ),
);
