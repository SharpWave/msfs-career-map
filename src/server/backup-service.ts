import { BackupQueue, type BackupJob } from "./backup-queue.ts";
import { backupWithFallback, backupsFolder, takeBackup } from "./backup.ts";
import { currentInputs } from "./inputs.ts";
import { serverStatus } from "./status.ts";

/**
 * The server's backups of its own logbook: the private channel's (daily, before an update, at
 * `--quit`) and **Back up now**'s, one at a time through one queue. The database module is loaded
 * only when a backup runs, so the server can take requests before its start-up work is done.
 */

// @spec APP-BAK-001, APP-BAK-002, APP-BAK-006
async function runBackup(job: BackupJob): Promise<string> {
  const { db, DATA_DIR, IMAGES_DIR } = await import("./db.ts");
  const { readLogbookId } = await import("./logbook-id.ts");
  const logbookId = serverStatus().logbookId ?? readLogbookId(db);
  if (!logbookId) throw new Error("the logbook has no id yet");
  const inputs = currentInputs();
  const common = { kind: job.kind, logbookId, imagesDir: IMAGES_DIR, signal: job.signal, onProgress: job.onProgress };
  // Before an update, a backups folder that cannot be written gives way to the data folder.
  if (job.kind.startsWith("update-")) return backupWithFallback(db, { ...common, backups: inputs.backups, dataFolder: DATA_DIR });
  return takeBackup(db, { ...common, folder: await backupsFolder(inputs.backups) });
}

export const backupQueue = new BackupQueue(runBackup);
