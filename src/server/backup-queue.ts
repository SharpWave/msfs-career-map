/**
 * Backups one at a time, in the order asked for. Held while the start-up work runs and while a
 * logbook is being brought in; abandoned at shutdown, the backup under way aborted and those
 * waiting never answered.
 */

export interface BackupJob {
  kind: string;
  signal: AbortSignal;
  onProgress?: () => void;
}

interface Waiting extends Omit<BackupJob, "signal"> {
  resolve(file: string): void;
  reject(e: unknown): void;
}

// @spec APP-BAK-005
export class BackupQueue {
  private waiting: Waiting[] = [];
  private running: AbortController | null = null;
  private holds = new Set<string>();
  private abandoned = false;
  /** Settles once the backup under way has settled, its unfinished file deleted. */
  private settled: Promise<void> | null = null;

  constructor(private run: (job: BackupJob) => Promise<string>) {}

  /** A backup of `kind`, taken in turn; its file's path, or the failure. */
  request(kind: string, onProgress?: () => void): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      if (this.abandoned) return; // left unanswered: the server is shutting down
      this.waiting.push({ kind, onProgress, resolve, reject });
      this.next();
    });
  }

  /** Hold backups for `reason` (the start-up work, a logbook being brought in) until released. */
  hold(reason: string): void {
    this.holds.add(reason);
  }

  release(reason: string): void {
    this.holds.delete(reason);
    this.next();
  }

  /** At shutdown: the backup under way aborted, and nothing more taken or answered. */
  abandon(): Promise<void> {
    this.abandoned = true;
    this.waiting = [];
    this.running?.abort();
    return this.settled ?? Promise.resolve();
  }

  private next(): void {
    if (this.running || this.holds.size > 0 || this.abandoned) return;
    const job = this.waiting.shift();
    if (!job) return;
    const ac = new AbortController();
    this.running = ac;
    const p = this.run({ kind: job.kind, signal: ac.signal, onProgress: job.onProgress });
    this.settled = p.then(
      () => {},
      () => {},
    );
    p.then(
      (file) => {
        this.running = null;
        if (!this.abandoned) job.resolve(file);
        this.next();
      },
      (e) => {
        this.running = null;
        if (!this.abandoned) job.reject(e);
        this.next();
      },
    );
  }
}
