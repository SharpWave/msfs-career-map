/**
 * The backups the desktop shell asks its server for (src/desktop/backups.ts; m2 contract §10.1):
 * the Back up request's shapes and ids on the private channel (DESK-SHELL-SRV-018), the daily and
 * the `--quit` kinds and the kind before an update naming its version (DESK-SHELL-BAK-005), the
 * 60 s bound without progress (DESK-SHELL-BAK-006), a starting server asked like a running one
 * (DESK-SHELL-BAK-007), no server meaning no request (DESK-SHELL-BAK-008), and an exit of the
 * server while a backup is outstanding: code 12 cuts it short (DESK-SHELL-SRV-043), any other code
 * fails it at once; and a session end abandoning every backup still running (DESK-SHELL-QUIT-005).
 */
import { describe, expect, it } from "vitest";
import { BackupRequests, type BackupKind, type BackupOutcome } from "../../../src/desktop/backups.ts";
import type { Supervisor } from "../../../src/desktop/supervisor.ts";
import { FakeClock, flush } from "../support/clock.ts";

/** A plain object standing in for the Supervisor: whether a process exists, what was posted, and the server's side. */
interface SupervisorStandIn extends Pick<Supervisor, "hasProcess" | "post" | "onMessage" | "onExit"> {
  process: boolean;
  posted: object[];
  /** The server posted this on the private channel. */
  message(msg: unknown): void;
  /** The server's process exited. */
  exit(code: number, requested?: boolean): void;
}

function supervisorStandIn(): SupervisorStandIn {
  const messageFns: ((msg: unknown) => void)[] = [];
  const exitFns: ((e: { code: number; requested: boolean }) => void)[] = [];
  const s: SupervisorStandIn = {
    process: true,
    posted: [],
    hasProcess: () => s.process,
    post: (msg: object) => {
      if (!s.process) return false;
      s.posted.push(msg);
      return true;
    },
    onMessage: (fn: (msg: unknown) => void) => {
      messageFns.push(fn);
    },
    onExit: (fn: (e: { code: number; requested: boolean }) => void) => {
      exitFns.push(fn);
    },
    message: (msg) => {
      for (const fn of messageFns) fn(msg);
    },
    exit: (code, requested = code === 12) => {
      for (const fn of exitFns) fn({ code, requested });
    },
  };
  return s;
}

function setup() {
  const clock = new FakeClock();
  const supervisor = supervisorStandIn();
  const lines: string[] = [];
  const backups = new BackupRequests({ clock, supervisor, log: (line: string) => lines.push(line) });
  return { clock, supervisor, lines, backups };
}

/** Watches a request's promise without awaiting it. */
function watch(p: Promise<BackupOutcome>): { done: boolean; outcome: BackupOutcome | undefined } {
  const w: { done: boolean; outcome: BackupOutcome | undefined } = { done: false, outcome: undefined };
  void p.then((o) => {
    w.done = true;
    w.outcome = o;
  });
  return w;
}

const NO_PROGRESS: BackupOutcome = {
  ok: false,
  why: "failed",
  short: "no progress for 60 s",
  reason: "the backup reported no progress for 60 s",
};
const SERVER_STOPPED: BackupOutcome = {
  ok: false,
  why: "failed",
  short: "the server stopped",
  reason: "the server stopped before the backup was done",
};

describe("the Back up request on the private channel", () => {
  // @spec DESK-SHELL-SRV-018, DESK-SHELL-BAK-005
  it("posts the daily, the --quit and the before-update kinds, with ids backup-1, backup-2… in the run", async () => {
    const { supervisor, backups } = setup();
    const kinds: BackupKind[] = ["daily", "quit", { update: "0.9.0" }];
    for (const kind of kinds) void backups.request(kind);
    await flush();
    expect(supervisor.posted).toEqual([
      { type: "backup", id: "backup-1", kind: "daily" },
      { type: "backup", id: "backup-2", kind: "quit" },
      { type: "backup", id: "backup-3", kind: "update", version: "0.9.0" },
    ]);
  });

  // @spec DESK-SHELL-BAK-007
  it("sends the request to a server that has a process, ready or not, inside the same bound", async () => {
    const { clock, supervisor, backups } = setup();
    // The Supervisor holds a post before its process spawns and sends it at the spawn; all the
    // backups need from it is a process.
    supervisor.process = true;
    const w = watch(backups.request("daily"));
    await flush();
    expect(supervisor.posted).toEqual([{ type: "backup", id: "backup-1", kind: "daily" }]);
    await clock.advance(59_999);
    expect(w.done).toBe(false);
    await clock.advance(1);
    expect(w.outcome).toEqual(NO_PROGRESS);
  });

  // @spec DESK-SHELL-BAK-008
  it("answers no-server at once and sends nothing while no server process exists", async () => {
    const { clock, supervisor, backups, lines } = setup();
    supervisor.process = false;
    const w = watch(backups.request("daily"));
    await flush();
    expect(w.outcome).toEqual({ ok: false, why: "no-server" });
    expect(supervisor.posted).toEqual([]);
    expect(clock.pending()).toBe(0);
    expect(lines.filter((l) => l.includes("failed"))).toEqual([]);
  });
});

describe("the server's answers", () => {
  // @spec DESK-SHELL-SRV-018
  it("passes backup-done through with its file, leaving no wait behind", async () => {
    const { clock, supervisor, backups, lines } = setup();
    const w = watch(backups.request("quit"));
    await flush();
    await clock.advance(5_000);
    supervisor.message({ type: "backup-done", id: "backup-1", file: "C:\\Backups\\career-2026-10-25-1200.db" });
    await flush();
    expect(w.outcome).toEqual({ ok: true, file: "C:\\Backups\\career-2026-10-25-1200.db" });
    expect(clock.pending()).toBe(0);
    expect(lines.filter((l) => l.includes("failed"))).toEqual([]);
  });

  // @spec DESK-SHELL-SRV-018, DESK-SHELL-BAK-004, DESK-SHELL-BAK-006
  it("passes backup-failed through with its short and full reason, and logs the failure by its kind", async () => {
    const { clock, supervisor, backups, lines } = setup();
    const daily = watch(backups.request("daily"));
    const update = watch(backups.request({ update: "0.9.0" }));
    await flush();
    supervisor.message({ type: "backup-failed", id: "backup-1", short: "the disk is full", reason: "could not write the backup: the disk is full" });
    supervisor.message({ type: "backup-failed", id: "backup-2", short: "no access", reason: "the backups folder cannot be written" });
    await flush();
    expect(daily.outcome).toEqual({ ok: false, why: "failed", short: "the disk is full", reason: "could not write the backup: the disk is full" });
    expect(update.outcome).toEqual({ ok: false, why: "failed", short: "no access", reason: "the backups folder cannot be written" });
    expect(lines).toContain("[backup] daily backup failed: could not write the backup: the disk is full");
    expect(lines).toContain("[backup] update backup failed: the backups folder cannot be written");
    expect(clock.pending()).toBe(0);
  });

  // @spec DESK-SHELL-SRV-018
  it("ignores answers to ids it never asked for", async () => {
    const { supervisor, backups } = setup();
    const w = watch(backups.request("daily"));
    await flush();
    supervisor.message({ type: "backup-done", id: "backup-7", file: "C:\\Backups\\x.db" });
    supervisor.message({ type: "backup-failed", id: "backup-8", short: "x", reason: "y" });
    await flush();
    expect(w.done).toBe(false);
    supervisor.message({ type: "backup-done", id: "backup-1", file: "C:\\Backups\\career.db" });
    await flush();
    expect(w.outcome).toEqual({ ok: true, file: "C:\\Backups\\career.db" });
  });
});

describe("the 60 s bound without progress", () => {
  // @spec DESK-SHELL-BAK-006, DESK-SHELL-SRV-037
  it("fails a backup with no answer 60 s after the request, with the pinned reasons and the log line", async () => {
    const { clock, backups, lines } = setup();
    const w = watch(backups.request("quit"));
    await flush();
    // The system clock moving changes no wait.
    clock.setWall("2026-10-27T00:00:00.000Z");
    await clock.advance(59_999);
    expect(w.done).toBe(false);
    await clock.advance(1);
    expect(w.outcome).toEqual(NO_PROGRESS);
    expect(lines).toContain("[backup] quit backup failed: the backup reported no progress for 60 s");
    expect(clock.pending()).toBe(0);
  });

  // @spec DESK-SHELL-BAK-006
  it("starts the 60 s again at each progress report of its own id", async () => {
    const { clock, supervisor, backups } = setup();
    const w = watch(backups.request("daily"));
    await flush();
    await clock.advance(50_000);
    supervisor.message({ type: "backup-progress", id: "backup-1" });
    await clock.advance(50_000);
    supervisor.message({ type: "backup-progress", id: "backup-1" });
    // Another id's progress extends nothing.
    await clock.advance(30_000);
    supervisor.message({ type: "backup-progress", id: "backup-9" });
    await clock.advance(29_999);
    expect(w.done).toBe(false);
    await clock.advance(1);
    expect(w.outcome).toEqual(NO_PROGRESS);
  });

  // @spec DESK-SHELL-BAK-006
  it("reports done after a long backup that kept reporting progress", async () => {
    const { clock, supervisor, backups } = setup();
    const w = watch(backups.request("daily"));
    await flush();
    for (let i = 0; i < 10; i++) {
      await clock.advance(45_000);
      supervisor.message({ type: "backup-progress", id: "backup-1" });
    }
    supervisor.message({ type: "backup-done", id: "backup-1", file: "C:\\Backups\\big.db" });
    await flush();
    expect(w.outcome).toEqual({ ok: true, file: "C:\\Backups\\big.db" });
    expect(clock.pending()).toBe(0);
  });
});

describe("an exit of the server while backups are outstanding", () => {
  // @spec DESK-SHELL-SRV-043
  it("cuts every outstanding backup short at once on code 12, counting none as failed", async () => {
    const { clock, supervisor, backups, lines } = setup();
    const a = watch(backups.request("daily"));
    const b = watch(backups.request("quit"));
    await flush();
    await clock.advance(1_000);
    supervisor.exit(12);
    await flush();
    expect(a.outcome).toEqual({ ok: false, why: "cut-short" });
    expect(b.outcome).toEqual({ ok: false, why: "cut-short" });
    expect(lines.filter((l) => l.includes("failed"))).toEqual([]);
    expect(clock.pending()).toBe(0);
  });

  // @spec DESK-SHELL-SRV-043
  it("cuts it short on code 12 also while the shell is quitting (the exit not a requested restart)", async () => {
    const { supervisor, backups } = setup();
    const w = watch(backups.request("daily"));
    await flush();
    supervisor.exit(12, false);
    await flush();
    expect(w.outcome).toEqual({ ok: false, why: "cut-short" });
  });

  // @spec DESK-SHELL-BAK-006
  it("fails every outstanding backup at once on any other code, not 60 s later", async () => {
    for (const code of [0, 1, 10]) {
      const { clock, supervisor, backups, lines } = setup();
      const a = watch(backups.request("daily"));
      const b = watch(backups.request({ update: "0.9.0" }));
      await flush();
      await clock.advance(2_000);
      supervisor.exit(code);
      await flush();
      expect(a.outcome).toEqual(SERVER_STOPPED);
      expect(b.outcome).toEqual(SERVER_STOPPED);
      expect(lines).toContain("[backup] daily backup failed: the server stopped before the backup was done");
      expect(lines).toContain("[backup] update backup failed: the server stopped before the backup was done");
      expect(clock.pending()).toBe(0);
    }
  });

  // @spec DESK-SHELL-BAK-006
  it("leaves nothing outstanding to answer after the exit: a later answer changes nothing", async () => {
    const { clock, supervisor, backups } = setup();
    const w = watch(backups.request("daily"));
    await flush();
    supervisor.exit(1);
    await flush();
    supervisor.message({ type: "backup-done", id: "backup-1", file: "C:\\Backups\\late.db" });
    await clock.advance(120_000);
    expect(w.outcome).toEqual(SERVER_STOPPED);
  });
});

describe("abandoning at a session end", () => {
  // @spec DESK-SHELL-QUIT-005
  it("resolves every outstanding request as abandoned and leaves no wait behind", async () => {
    const { clock, supervisor, backups } = setup();
    const a = watch(backups.request("daily"));
    const b = watch(backups.request("quit"));
    await flush();
    backups.abandon();
    await flush();
    expect(a.outcome).toEqual({ ok: false, why: "abandoned" });
    expect(b.outcome).toEqual({ ok: false, why: "abandoned" });
    expect(clock.pending()).toBe(0);
    supervisor.message({ type: "backup-done", id: "backup-2", file: "C:\\Backups\\late.db" });
    await clock.advance(120_000);
    expect(b.outcome).toEqual({ ok: false, why: "abandoned" });
  });
});
