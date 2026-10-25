import type { Cancel, Clock } from "./ports.ts";
import type { Supervisor } from "./supervisor.ts";
import { TIMING } from "./timing.ts";

/**
 * The backups the shell asks its server for on the private channel: daily, at `--quit` and before an
 * update. Each is bounded by 60 s without progress, and an exit of the server resolves every one
 * still outstanding at once.
 */

export type BackupKind = "daily" | "quit" | { update: string };
export type BackupOutcome =
  | { ok: true; file: string }
  | { ok: false; why: "failed"; short: string; reason: string }
  | { ok: false; why: "no-server" }
  | { ok: false; why: "cut-short" }
  | { ok: false; why: "abandoned" };

export interface BackupRequestsOptions {
  clock: Clock;
  supervisor: Pick<Supervisor, "hasProcess" | "post" | "onMessage" | "onExit">;
  log(line: string): void;
}

interface Outstanding {
  kind: BackupKind;
  bound: Cancel;
  resolve(o: BackupOutcome): void;
}

const NO_PROGRESS = { short: "no progress for 60 s", reason: "the backup reported no progress for 60 s" };
const SERVER_STOPPED = { short: "the server stopped", reason: "the server stopped before the backup was done" };

const kindName = (kind: BackupKind): string => (typeof kind === "string" ? kind : "update");

function requestMessage(id: string, kind: BackupKind): object {
  return typeof kind === "string" ? { type: "backup", id, kind } : { type: "backup", id, kind: "update", version: kind.update };
}

/** A field of a private-channel message, when the message is an object. */
function field(msg: unknown, name: string): unknown {
  return typeof msg === "object" && msg !== null ? (msg as Record<string, unknown>)[name] : undefined;
}

// @spec DESK-SHELL-SRV-018, DESK-SHELL-SRV-043, DESK-SHELL-BAK-005, DESK-SHELL-BAK-006, DESK-SHELL-BAK-007, DESK-SHELL-BAK-008, DESK-SHELL-QUIT-005
export class BackupRequests {
  private readonly o: BackupRequestsOptions;
  private readonly outstanding = new Map<string, Outstanding>();
  private next = 1;

  constructor(o: BackupRequestsOptions) {
    this.o = o;
    o.supervisor.onMessage((msg: unknown) => this.answer(msg));
    o.supervisor.onExit((e: { code: number }) => {
      for (const id of [...this.outstanding.keys()]) {
        if (e.code === 12) this.finish(id, { ok: false, why: "cut-short" });
        else this.fail(id, SERVER_STOPPED);
      }
    });
  }

  /** Asks the server for a backup; no-server at once, sending nothing, while no server process exists. */
  request(kind: BackupKind): Promise<BackupOutcome> {
    if (!this.o.supervisor.hasProcess()) return Promise.resolve({ ok: false, why: "no-server" });
    const id = `backup-${this.next++}`;
    return new Promise((resolve) => {
      this.outstanding.set(id, { kind, resolve, bound: this.bound(id) });
      if (!this.o.supervisor.post(requestMessage(id, kind))) this.finish(id, { ok: false, why: "no-server" });
    });
  }

  /** Every outstanding request resolves "abandoned". */
  abandon(): void {
    for (const id of [...this.outstanding.keys()]) this.finish(id, { ok: false, why: "abandoned" });
  }

  private bound(id: string): Cancel {
    return this.o.clock.after(TIMING.backupIdleMs, () => this.fail(id, NO_PROGRESS));
  }

  private answer(msg: unknown): void {
    const id = field(msg, "id");
    if (typeof id !== "string") return;
    const request = this.outstanding.get(id);
    if (!request) return;
    switch (field(msg, "type")) {
      case "backup-progress":
        request.bound();
        request.bound = this.bound(id);
        break;
      case "backup-done":
        this.finish(id, { ok: true, file: String(field(msg, "file")) });
        break;
      case "backup-failed":
        this.fail(id, { short: String(field(msg, "short")), reason: String(field(msg, "reason")) });
        break;
    }
  }

  private fail(id: string, f: { short: string; reason: string }): void {
    const request = this.outstanding.get(id);
    if (!request) return;
    this.o.log(`[backup] ${kindName(request.kind)} backup failed: ${f.reason}`);
    this.finish(id, { ok: false, why: "failed", ...f });
  }

  private finish(id: string, outcome: BackupOutcome): void {
    const request = this.outstanding.get(id);
    if (!request) return;
    this.outstanding.delete(id);
    request.bound();
    request.resolve(outcome);
  }
}
