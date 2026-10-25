/**
 * The shutdown order (shutdown.ts), the stop signals, and the private channel's messages
 * (channel.ts), in process:
 * - `shutDown` with spy parts: its exact order, parts skipped, steps that throw, the 5 s deadline,
 *   the guard per parts object, and parts read at each step rather than once;
 * - `shutDown` with a real Tracker linked to a fake sim: the link stopped first, so the final
 *   checkpoint holds the leg as it was, and casual mode switched off only when quitting;
 * - `installStopSignals` on a stand-in target;
 * - `serveChannel` and `privateChannel` on stand-in channels and hosts.
 *
 * In process, `privateChannel` and `installStopSignals` always get a stand-in: a Vitest worker has
 * an IPC channel of its own, and its `process` is not the server's.
 */
import { EventEmitter } from "node:events";
import { inspect } from "node:util";
import { open } from "node-simconnect";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { privateChannel, serveChannel, type ChannelHost, type PrivateChannel } from "../../src/server/channel.ts";
import { installStopSignals, shutDown, shutdownBegun, type ShutdownParts } from "../../src/server/shutdown.ts";
import type { SimSample } from "../../src/server/simconnect.ts";
import { Tracker } from "../../src/server/tracker.ts";
import { FakeSimHandle, answerOpen, linkTracker, settle, simPilot } from "../live-tracking/fake-sim.ts";
import { hopCount, readCheckpoint, resetLogbook } from "../live-tracking/state.ts";

vi.mock("node-simconnect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node-simconnect")>()),
  open: vi.fn(),
}));

const SHUTTING_DOWN_LINE = "[server] shutting down";
const WAL_CHECKPOINT = "PRAGMA wal_checkpoint(TRUNCATE)";
const STOP_SIGNALS = ["SIGINT", "SIGBREAK", "SIGHUP", "SIGTERM"] as const;

/** Let pending promise callbacks run (works under fake timers too). */
const flush = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};

describe("shutDown with spy parts", () => {
  /**
   * Every step taken and every `[server] shutting down` line, in order. Other console.log lines are
   * the order's own business (contract §9) and are left out.
   */
  let calls: string[];
  let logs: MockInstance<typeof console.log>;
  let errors: MockInstance<typeof console.error>;

  beforeEach(() => {
    calls = [];
    vi.useFakeTimers();
    logs = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      const line = a.map(String).join(" ");
      if (line === SHUTTING_DOWN_LINE) calls.push(`log ${line}`);
    });
    errors = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    logs.mockRestore();
    errors.mockRestore();
    vi.useRealTimers();
  });

  /** A spy that records `name(<its first argument>)` and then runs `then`. */
  const step = (name: string, then?: () => void) =>
    vi.fn((...args: unknown[]) => {
      calls.push(args.length && typeof args[0] !== "function" ? `${name}(${typeof args[0] === "string" ? args[0] : JSON.stringify(args[0])})` : name);
      then?.();
    });

  /**
   * Fresh parts every time: the guard is keyed on the parts object. `http.close` holds its
   * callback until `closed()` runs it.
   */
  function spyParts() {
    let held: ((err?: Error) => void) | undefined;
    const parts = {
      link: { stop: step("link.stop") },
      tracker: { shutdown: step("tracker.shutdown") },
      http: {
        closeAllConnections: step("http.closeAllConnections"),
        close: vi.fn((cb?: (err?: Error) => void) => {
          calls.push("http.close");
          held = cb;
        }),
      },
      db: { exec: step("db.exec"), close: step("db.close") },
      lock: { release: step("lock.release") },
    };
    const exit = step("exit");
    return {
      parts,
      exit,
      /** http.close's callback, run now. */
      closed: () => {
        if (!held) throw new Error("http.close was not called with a callback");
        held();
      },
    };
  }

  const ALL_STEPS = [
    `log ${SHUTTING_DOWN_LINE}`,
    "link.stop",
    'tracker.shutdown({"quitting":true})',
    "http.closeAllConnections",
    "http.close",
    `db.exec(${WAL_CHECKPOINT})`,
    "db.close",
    "lock.release",
    "exit(0)",
  ];

  /** Whether `err`, or its message, was written out with console.error. */
  const wroteOut = (err: Error) => errors.mock.calls.some((args) => args.some((a) => a === err || String(a).includes(err.message)));

  // @spec APP-SRV-016, LIVE-LINK-011, LIVE-SAVE-005, LIVE-CASUAL-013
  it("writes its line, stops the link, has the tracker write its final checkpoint, closes the server, waits for it, checkpoints and closes the database, removes the lock and exits 0, in that order and once", async () => {
    const { parts, exit, closed } = spyParts();
    const p = shutDown(parts, { quitting: true, exit });
    await flush();
    // Waiting for the server to stop listening: nothing after it has run.
    expect(calls).toEqual(ALL_STEPS.slice(0, 5));
    expect(exit).not.toHaveBeenCalled();

    closed();
    await vi.advanceTimersByTimeAsync(0);
    await p;
    expect(calls).toEqual(ALL_STEPS);
    expect(parts.tracker.shutdown).toHaveBeenCalledWith({ quitting: true });
    expect(parts.db.exec).toHaveBeenCalledWith(WAL_CHECKPOINT);
    expect(exit.mock.calls).toEqual([[0]]);

    // The deadline, once it would have run out, calls exit no second time.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(exit.mock.calls).toEqual([[0]]);
    expect(calls).toEqual(ALL_STEPS);
    expect(errors).not.toHaveBeenCalled();
  });

  // @spec APP-SRV-016, LIVE-CASUAL-013
  it("skips the parts it does not have, null or absent, and passes quitting on as given", async () => {
    const none = vi.fn();
    await shutDown({}, { quitting: true, exit: none });
    expect(none.mock.calls).toEqual([[0]]);
    expect(calls).toEqual([`log ${SHUTTING_DOWN_LINE}`]);

    calls.length = 0;
    const { parts, exit } = spyParts();
    const some: ShutdownParts = { link: null, tracker: parts.tracker, http: null, db: undefined, lock: parts.lock };
    await shutDown(some, { quitting: false, exit });
    expect(calls).toEqual([`log ${SHUTTING_DOWN_LINE}`, 'tracker.shutdown({"quitting":false})', "lock.release", "exit(0)"]);
    expect(exit.mock.calls).toEqual([[0]]);
    expect(errors).not.toHaveBeenCalled();
  });

  // @spec APP-SRV-016
  it("writes out a tracker.shutdown that throws and still closes the server, the database and the lock, and exits 0", async () => {
    const { parts, exit, closed } = spyParts();
    const boom = new Error("the final checkpoint failed");
    parts.tracker.shutdown.mockImplementation(() => {
      calls.push("tracker.shutdown");
      throw boom;
    });
    const p = shutDown(parts, { quitting: true, exit });
    await flush();
    closed();
    await vi.advanceTimersByTimeAsync(0);
    await expect(p).resolves.toBeUndefined();

    expect(calls).toEqual([
      `log ${SHUTTING_DOWN_LINE}`,
      "link.stop",
      "tracker.shutdown",
      "http.closeAllConnections",
      "http.close",
      `db.exec(${WAL_CHECKPOINT})`,
      "db.close",
      "lock.release",
      "exit(0)",
    ]);
    expect(wroteOut(boom)).toBe(true);
    expect(exit.mock.calls).toEqual([[0]]);
  });

  // @spec APP-SRV-016
  it("writes out every step that throws, http.close included, and goes on to the next, still exiting 0 once", async () => {
    const thrown: Error[] = [];
    const throwing = (name: string) =>
      vi.fn(() => {
        calls.push(name);
        const e = new Error(`${name} failed`);
        thrown.push(e);
        throw e;
      });
    const parts = {
      link: { stop: throwing("link.stop") },
      tracker: { shutdown: throwing("tracker.shutdown") },
      // A close that throws never calls back: the order must not wait for it.
      http: { closeAllConnections: throwing("http.closeAllConnections"), close: throwing("http.close") },
      db: { exec: throwing("db.exec"), close: throwing("db.close") },
      lock: { release: throwing("lock.release") },
    };
    const exit = step("exit");
    const p = shutDown(parts, { quitting: false, exit });
    await flush();
    await vi.advanceTimersByTimeAsync(0);
    await expect(p).resolves.toBeUndefined();

    expect(calls).toEqual([
      `log ${SHUTTING_DOWN_LINE}`,
      "link.stop",
      "tracker.shutdown",
      "http.closeAllConnections",
      "http.close",
      "db.exec",
      "db.close",
      "lock.release",
      "exit(0)",
    ]);
    expect(thrown).toHaveLength(7);
    for (const e of thrown) expect(wroteOut(e), e.message).toBe(true);
    expect(exit.mock.calls).toEqual([[0]]);
  });

  // @spec APP-SRV-016
  it("exits 0 at 5000 ms, not at 4999, when the server never finishes closing, and only once", async () => {
    const { parts, exit } = spyParts();
    void shutDown(parts, { quitting: true, exit });
    await flush();
    expect(parts.http.close).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4999);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(exit.mock.calls).toEqual([[0]]);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(exit.mock.calls).toEqual([[0]]);
    // Still waiting for the close: the steps after it never ran.
    expect(parts.db.exec).not.toHaveBeenCalled();
    expect(parts.db.close).not.toHaveBeenCalled();
    expect(parts.lock.release).not.toHaveBeenCalled();
  });

  // @spec APP-SRV-016
  it("returns the very same promise to a second call with the same parts, repeating no step and calling neither exit again", async () => {
    const { parts, exit, closed } = spyParts();
    const exit2 = vi.fn();
    const p1 = shutDown(parts, { quitting: true, exit });
    const p2 = shutDown(parts, { quitting: false, exit: exit2 });
    expect(p2).toBe(p1);

    await flush();
    closed();
    await vi.advanceTimersByTimeAsync(0);
    await p1;
    const p3 = shutDown(parts, { quitting: false, exit: exit2 });
    expect(p3).toBe(p1);
    await flush();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(calls).toEqual(ALL_STEPS);
    expect(parts.tracker.shutdown.mock.calls).toEqual([[{ quitting: true }]]);
    for (const spy of [parts.link.stop, parts.http.closeAllConnections, parts.http.close, parts.db.exec, parts.db.close, parts.lock.release]) {
      expect(spy).toHaveBeenCalledTimes(1);
    }
    expect(exit.mock.calls).toEqual([[0]]);
    expect(exit2).not.toHaveBeenCalled();
  });

  // @spec APP-SRV-016
  it("keeps the deadline of the first call: a second call starts none of its own", async () => {
    const { parts, exit } = spyParts();
    const exit2 = vi.fn();
    const p1 = shutDown(parts, { quitting: true, exit });
    await vi.advanceTimersByTimeAsync(3000);
    expect(shutDown(parts, { quitting: true, exit: exit2 })).toBe(p1);

    await vi.advanceTimersByTimeAsync(1999);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(exit.mock.calls).toEqual([[0]]);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(exit.mock.calls).toEqual([[0]]);
    expect(exit2).not.toHaveBeenCalled();
  });

  // @spec APP-SRV-016
  it("says a shutdown has begun from the first call on, for that parts object only", async () => {
    const parts: ShutdownParts = {};
    const other: ShutdownParts = {};
    expect(shutdownBegun(parts)).toBe(false);
    const p = shutDown(parts, { quitting: false, exit: vi.fn() });
    expect(shutdownBegun(parts)).toBe(true);
    expect(shutdownBegun(other)).toBe(false);
    await p;
    expect(shutdownBegun(parts)).toBe(true);
    expect(shutdownBegun(other)).toBe(false);
  });

  // @spec APP-SRV-016
  it("reads each part when it reaches its step: parts given or replaced while the server closes are the ones used", async () => {
    const { parts: early, exit, closed } = spyParts();
    const parts: ShutdownParts = { http: early.http, db: { exec: step("old db.exec"), close: step("old db.close") } };
    const p = shutDown(parts, { quitting: true, exit });
    await flush();
    expect(calls).toEqual([`log ${SHUTTING_DOWN_LINE}`, "http.closeAllConnections", "http.close"]);

    // The start-up reaches its later steps while the server is still closing.
    const late = {
      link: { stop: step("late link.stop") },
      tracker: { shutdown: step("late tracker.shutdown") },
      db: { exec: step("late db.exec"), close: step("late db.close") },
      lock: { release: step("late lock.release") },
    };
    parts.link = late.link;
    parts.tracker = late.tracker;
    parts.db = late.db;
    parts.lock = late.lock;
    closed();
    await vi.advanceTimersByTimeAsync(0);
    await p;

    expect(calls).toEqual([
      `log ${SHUTTING_DOWN_LINE}`,
      "http.closeAllConnections",
      "http.close",
      `late db.exec(${WAL_CHECKPOINT})`,
      "late db.close",
      "late lock.release",
      "exit(0)",
    ]);
    // Their steps had already passed.
    expect(late.link.stop).not.toHaveBeenCalled();
    expect(late.tracker.shutdown).not.toHaveBeenCalled();
  });
});

describe("shutDown with a real tracker linked to a fake sim", () => {
  const LIVERY = "N1TP";
  let logs: MockInstance<typeof console.log>;

  beforeEach(() => {
    vi.mocked(open).mockReset();
    // Any connection attempt beyond the answered ones waits forever.
    vi.mocked(open).mockImplementation(() => new Promise(() => {}) as never);
    resetLogbook();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-24T12:00:00Z"));
    logs = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterEach(() => {
    logs.mockRestore();
    vi.useRealTimers();
  });

  /** A tracker linked to a fake sim whose close() reports the close at once, as the real handle does. */
  async function linked() {
    const tr = new Tracker();
    const hd = new FakeSimHandle();
    hd.close.mockImplementation(() => {
      hd.emit("close");
    });
    answerOpen(hd);
    const link = linkTracker(tr);
    await settle();
    hd.livery(LIVERY);
    return { tr, hd, link, f: simPilot(hd) };
  }

  // @spec LIVE-LINK-011, LIVE-SAVE-005, APP-SRV-016
  it("stops the link before the final checkpoint: the airborne leg comes back unchanged, still airborne, with no pending leg", async () => {
    const { tr, hd, link, f } = await linked();
    try {
      f.ground(3);
      f.air(70);
      const before = tr.status();
      expect(before.connected).toBe(true);
      expect(before.phase).toBe("airborne");
      expect(before.leg?.origin).toBe("KPVD");

      const exit = vi.fn();
      await shutDown({ link, tracker: tr }, { quitting: false, exit });
      expect(exit.mock.calls).toEqual([[0]]);
      expect(hd.close).toHaveBeenCalled();

      // What the old connection may still send after its close reaches nothing.
      vi.setSystemTime(Date.now() + 10_000);
      hd.position({ ...f.position, on_ground: true, gs_kts: 40 });
      hd.quit();
      hd.lose();
      await settle();

      const saved = readCheckpoint();
      expect(saved?.phase).toBe("airborne");
      expect(saved?.pending).toEqual([]);
      const restored = new Tracker().status();
      expect(restored.phase).toBe("airborne");
      expect(restored.leg).toEqual(before.leg);
      expect(restored.position).toEqual(before.position);
      expect(restored.pending).toEqual([]);
      expect(hopCount()).toBe(0);
    } finally {
      link.stop();
    }
  });

  // @spec LIVE-SAVE-005, LIVE-LINK-011, APP-SRV-016
  it("keeps a landed leg landed, logs no hop, and the restored leg's touchdown is not rated again", async () => {
    const { tr, link, f } = await linked();
    try {
      f.ground(3);
      f.air(70);
      // Touched down and still rolling: landed, not yet stopped.
      f.ground(3, 30);
      const before = tr.status();
      expect(before.phase).toBe("landed");
      expect(before.leg?.landings).toHaveLength(1);
      const landings = structuredClone(before.leg!.landings);

      await shutDown({ link, tracker: tr }, { quitting: false, exit: vi.fn() });
      expect(hopCount()).toBe(0);

      const restored = new Tracker();
      const st = restored.status();
      expect(st.phase).toBe("landed");
      expect(st.leg?.landings).toEqual(landings);
      expect(st.pending).toEqual([]);

      // The next sample, on the ground and still rolling.
      const next: SimSample = { ...f.position, t: Date.now(), on_ground: true, gs_kts: 20, ias_kts: 20, alt_ft: 55, vs_fpm: 0, livery: LIVERY };
      restored.feed(next);
      const after = restored.status();
      expect(after.phase).toBe("landed");
      expect(after.leg?.landings).toEqual(landings);
      expect(after.pending).toEqual([]);
      expect(hopCount()).toBe(0);
    } finally {
      link.stop();
    }
  });

  // @spec LIVE-CASUAL-013, APP-SRV-016, APP-SRV-018
  it("switches casual mode off in the final checkpoint when quitting, and leaves it on otherwise", async () => {
    const quitting = await linked();
    try {
      quitting.tr.setCasual(true);
      quitting.f.air(12);
      expect(quitting.tr.path().length).toBeGreaterThan(0);
      await shutDown({ link: quitting.link, tracker: quitting.tr }, { quitting: true, exit: vi.fn() });
      expect(readCheckpoint()?.casual ?? null).toBeNull();
      expect(new Tracker().status().casual).toBeNull();
    } finally {
      quitting.link.stop();
    }

    resetLogbook();
    const staying = await linked();
    try {
      staying.tr.setCasual(true);
      const since = staying.tr.status().casual!.since;
      staying.f.air(12);
      await shutDown({ link: staying.link, tracker: staying.tr }, { quitting: false, exit: vi.fn() });
      expect(readCheckpoint()?.casual).toEqual({ since: Date.parse(since) });
      expect(new Tracker().status().casual).toEqual({ since, points: 0 });
    } finally {
      staying.link.stop();
    }
  });
});

describe("installStopSignals", () => {
  // @spec APP-SRV-018
  it("calls onStop for each of SIGINT, SIGBREAK, SIGHUP and SIGTERM on its target, registers nothing else, and uninstalls them all", () => {
    const target = new EventEmitter();
    const onStop = vi.fn();
    const onProcess = Object.fromEntries(STOP_SIGNALS.map((s) => [s, process.listenerCount(s)]));

    const uninstall = installStopSignals(onStop, target);
    expect(typeof uninstall).toBe("function");
    expect([...target.eventNames()].sort()).toEqual([...STOP_SIGNALS].sort());
    for (const sig of STOP_SIGNALS) expect(target.listenerCount(sig), sig).toBe(1);

    STOP_SIGNALS.forEach((sig, i) => {
      target.emit(sig, sig);
      expect(onStop, sig).toHaveBeenCalledTimes(i + 1);
    });

    uninstall();
    expect(target.eventNames()).toEqual([]);
    for (const sig of STOP_SIGNALS) target.emit(sig, sig);
    expect(onStop).toHaveBeenCalledTimes(STOP_SIGNALS.length);

    // The stand-in target was used, not this process.
    for (const sig of STOP_SIGNALS) expect(process.listenerCount(sig), sig).toBe(onProcess[sig]);
  });
});

describe("serveChannel", () => {
  let logs: MockInstance<typeof console.log>;
  let errors: MockInstance<typeof console.error>;
  beforeEach(() => {
    logs = vi.spyOn(console, "log").mockImplementation(() => {});
    errors = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    logs.mockRestore();
    errors.mockRestore();
  });

  /** Let the handler finish, whether it answers at once or after a turn. */
  const turn = () => new Promise<void>((r) => setImmediate(r));
  const ignoring = (msg: unknown) => `[server] ignoring a message on the private channel: ${JSON.stringify(msg)}`;

  /** A stand-in channel: messages delivered by hand, every step and answer recorded in order. */
  function standIn() {
    const order: string[] = [];
    let deliver: ((msg: unknown) => void) | null = null;
    const sent: unknown[] = [];
    const ch: PrivateChannel = {
      send: vi.fn((msg: object) => {
        sent.push(msg);
        order.push(`send ${JSON.stringify(msg)}`);
      }),
      onMessage: vi.fn((fn: (msg: unknown) => void) => {
        deliver = fn;
      }),
    };
    const h = {
      save: vi.fn(() => {
        order.push("save");
      }),
      shutdown: vi.fn(() => {
        order.push("shutdown");
      }),
    };
    const log = vi.fn((line: string) => {
      order.push(`log ${line}`);
    });
    return {
      ch,
      h,
      log,
      sent,
      order,
      deliver: (msg: unknown) => {
        if (!deliver) throw new Error("serveChannel did not listen on the channel");
        deliver(msg);
      },
    };
  }

  // @spec APP-SRV-019, APP-SRV-022, LIVE-SAVE-004
  it("saves, then answers saved with the request's id, whatever JSON value it is", async () => {
    const c = standIn();
    serveChannel(c.ch, c.h, c.log);
    const ids: unknown[] = ["a", 7, null, { x: 1 }];
    for (const id of ids) {
      c.deliver({ type: "save", id });
      await turn();
    }
    expect(c.order).toEqual(ids.flatMap((id) => ["save", `send ${JSON.stringify({ type: "saved", id })}`]));
    expect(c.sent).toStrictEqual(ids.map((id) => ({ type: "saved", id })));
    expect(c.h.shutdown).not.toHaveBeenCalled();
    expect(c.log).not.toHaveBeenCalled();
  });

  // @spec APP-SRV-022
  it("writes out a save without an id property, and neither saves nor answers", async () => {
    const c = standIn();
    serveChannel(c.ch, c.h, c.log);
    c.deliver({ type: "save" });
    await turn();
    expect(c.order).toEqual([`log ${ignoring({ type: "save" })}`]);
    expect(c.h.save).not.toHaveBeenCalled();
    expect(c.ch.send).not.toHaveBeenCalled();
  });

  // @spec APP-SRV-019, APP-SRV-022
  it("writes out a save that fails with console.error, sends no answer, and answers the next save", async () => {
    const c = standIn();
    serveChannel(c.ch, c.h, c.log);
    c.h.save.mockImplementationOnce(() => {
      throw new Error("disk full");
    });
    expect(() => c.deliver({ type: "save", id: "first" })).not.toThrow();
    await turn();
    expect(errors).toHaveBeenCalledWith("[server] the save asked for on the private channel failed: disk full");
    expect(c.ch.send).not.toHaveBeenCalled();
    expect(c.log).not.toHaveBeenCalled();

    c.deliver({ type: "save", id: "second" });
    await turn();
    expect(c.sent).toStrictEqual([{ type: "saved", id: "second" }]);
  });

  // @spec APP-SRV-016, APP-SRV-022
  it("shuts down on {type: \"shutdown\"}, extra fields ignored, and answers nothing", async () => {
    const c = standIn();
    serveChannel(c.ch, c.h, c.log);
    c.deliver({ type: "shutdown" });
    await turn();
    expect(c.order).toEqual(["shutdown"]);

    c.deliver({ type: "shutdown", id: 3, reason: "quit" });
    await turn();
    expect(c.order).toEqual(["shutdown", "shutdown"]);
    expect(c.h.save).not.toHaveBeenCalled();
    expect(c.ch.send).not.toHaveBeenCalled();
    expect(c.log).not.toHaveBeenCalled();
  });

  // @spec APP-SRV-022
  it("writes the exact line for an unknown type, a string, null, a number and an array, and acts on none of them", async () => {
    const c = standIn();
    serveChannel(c.ch, c.h, c.log);
    const others: unknown[] = [{ type: "reboot", id: 1 }, "save", null, 42, [{ type: "save", id: 1 }], {}];
    for (const msg of others) c.deliver(msg);
    await turn();
    expect(c.log.mock.calls).toEqual(others.map((msg) => [ignoring(msg)]));
    expect(c.h.save).not.toHaveBeenCalled();
    expect(c.h.shutdown).not.toHaveBeenCalled();
    expect(c.ch.send).not.toHaveBeenCalled();
  });

  // @spec APP-SRV-022
  it("writes out a message JSON cannot hold (a BigInt, a cycle) as util.inspect shows it, without throwing", async () => {
    const c = standIn();
    serveChannel(c.ch, c.h, c.log);
    const big = { type: "reboot", n: 1n };
    const cycle: Record<string, unknown> = { type: "reboot" };
    cycle.self = cycle;
    expect(() => c.deliver(big)).not.toThrow();
    expect(() => c.deliver(cycle)).not.toThrow();
    await turn();
    expect(c.log.mock.calls).toEqual([
      [`[server] ignoring a message on the private channel: ${inspect(big, { breakLength: Infinity })}`],
      [`[server] ignoring a message on the private channel: ${inspect(cycle, { breakLength: Infinity })}`],
    ]);
    expect(c.h.save).not.toHaveBeenCalled();
    expect(c.h.shutdown).not.toHaveBeenCalled();
    expect(c.ch.send).not.toHaveBeenCalled();
  });

  // @spec APP-SRV-022
  it("writes through console.log when given no log", async () => {
    const c = standIn();
    serveChannel(c.ch, c.h);
    c.deliver({ type: "reboot" });
    await turn();
    expect(logs).toHaveBeenCalledWith(ignoring({ type: "reboot" }));
  });
});

describe("privateChannel", () => {
  /** A stand-in for Electron's process.parentPort: messages arrive as `{data}`. */
  const parentPort = () => Object.assign(new EventEmitter(), { postMessage: vi.fn((_msg: unknown) => {}) });
  const host = (fields: Record<string, unknown>) => Object.assign(new EventEmitter(), fields) as unknown as ChannelHost & EventEmitter;

  // @spec APP-SRV-022
  it("uses parentPort when it is there: messages from event.data, answers with postMessage, ahead of an IPC channel", () => {
    const port = parentPort();
    const send = vi.fn();
    const proc = host({ parentPort: port, send, channel: {} });
    const ch = privateChannel(proc);
    expect(ch).not.toBeNull();
    const got: unknown[] = [];
    ch!.onMessage((m) => got.push(m));

    port.emit("message", { data: { type: "save", id: 1 } });
    port.emit("message", { data: null });
    expect(got).toEqual([{ type: "save", id: 1 }, null]);

    ch!.send({ type: "saved", id: 1 });
    expect(port.postMessage.mock.calls.map((c) => c[0])).toEqual([{ type: "saved", id: 1 }]);
    expect(send).not.toHaveBeenCalled();

    // The IPC channel is not used alongside it, and nothing listens for the channel closing.
    proc.emit("message", { type: "save", id: 2 });
    expect(got).toHaveLength(2);
    expect(proc.listenerCount("message")).toBe(0);
    expect(proc.listenerCount("disconnect")).toBe(0);
    expect(port.eventNames()).toEqual(["message"]);
  });

  // @spec APP-SRV-022
  it("otherwise uses Node's IPC channel when send is a function and channel is set: process 'message' in, send out", () => {
    const send = vi.fn();
    const proc = host({ parentPort: undefined, send, channel: {} });
    const ch = privateChannel(proc);
    expect(ch).not.toBeNull();
    const got: unknown[] = [];
    ch!.onMessage((m) => got.push(m));

    proc.emit("message", { type: "save", id: "a" });
    proc.emit("message", "hello");
    expect(got).toEqual([{ type: "save", id: "a" }, "hello"]);

    ch!.send({ type: "saved", id: "a" });
    expect(send.mock.calls.map((c) => c[0])).toEqual([{ type: "saved", id: "a" }]);
    expect(proc.listenerCount("disconnect")).toBe(0);
  });

  // @spec APP-SRV-022
  it("is null without parentPort or a usable IPC channel", () => {
    expect(privateChannel(host({}))).toBeNull();
    expect(privateChannel(host({ send: vi.fn() }))).toBeNull();
    expect(privateChannel(host({ send: vi.fn(), channel: undefined }))).toBeNull();
    expect(privateChannel(host({ channel: {} }))).toBeNull();
    expect(privateChannel(host({ send: "not a function", channel: {} }))).toBeNull();
  });
});
