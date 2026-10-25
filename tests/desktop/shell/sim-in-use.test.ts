/**
 * The sim in use (src/desktop/sim-in-use.ts; m2 contract §12.1; DESK-SHELL-AWAY-001): this copy's
 * sim link connected or another copy holding the sim-link claim, as the tracker of a running server
 * reports it, or MSFS running for this Windows account whatever the server's state, found by a look
 * at the process list every 10 s on the monotonic clock (DESK-SHELL-SRV-037) and again at each step
 * that depends on it.
 */
import { describe, expect, it } from "vitest";
import { MsfsWatch, simInUse } from "../../../src/desktop/sim-in-use.ts";
import type { TrayTracker } from "../../../src/desktop/tracker-feed.ts";
import { FakeClock, flush } from "../support/clock.ts";
import { FakeFacts } from "../support/fakes.ts";

function tracker(o: Partial<TrayTracker> = {}): TrayTracker {
  return { connected: false, sim_name: null, link_holder: null, phase: "idle", leg: null, pending: [], casual: null, ...o };
}

describe("simInUse", () => {
  // @spec DESK-SHELL-AWAY-001
  it("holds while MSFS runs for this account, whatever the server's state", () => {
    expect(simInUse({ serverRunning: false, tracker: null, msfsRunning: true })).toBe(true);
    expect(simInUse({ serverRunning: true, tracker: tracker(), msfsRunning: true })).toBe(true);
    expect(simInUse({ serverRunning: false, tracker: tracker(), msfsRunning: true })).toBe(true);
  });

  // @spec DESK-SHELL-AWAY-001
  it("holds while a running server's tracker reports its sim link connected", () => {
    expect(simInUse({ serverRunning: true, tracker: tracker({ connected: true, sim_name: "MSFS 2024" }), msfsRunning: false })).toBe(true);
    expect(simInUse({ serverRunning: true, tracker: tracker({ connected: true }), msfsRunning: false })).toBe(true);
  });

  // @spec DESK-SHELL-AWAY-001
  it("holds while a running server's tracker reports another copy holding the sim link", () => {
    expect(
      simInUse({ serverRunning: true, tracker: tracker({ link_holder: { text: "Another copy holds the sim link" } }), msfsRunning: false }),
    ).toBe(true);
  });

  // @spec DESK-SHELL-AWAY-001
  it("does not hold with none of the three", () => {
    expect(simInUse({ serverRunning: true, tracker: tracker(), msfsRunning: false })).toBe(false);
    expect(simInUse({ serverRunning: true, tracker: null, msfsRunning: false })).toBe(false);
    expect(simInUse({ serverRunning: false, tracker: null, msfsRunning: false })).toBe(false);
    // A leg, casual mode or pending legs are not the sim in use.
    expect(
      simInUse({
        serverRunning: true,
        tracker: tracker({ phase: "landed", leg: { origin: "KBOS" }, casual: {}, pending: [{ id: "a" }] }),
        msfsRunning: false,
      }),
    ).toBe(false);
  });

  // @spec DESK-SHELL-AWAY-001
  it("ignores the last tracker status while no server process runs", () => {
    expect(simInUse({ serverRunning: false, tracker: tracker({ connected: true }), msfsRunning: false })).toBe(false);
    expect(simInUse({ serverRunning: false, tracker: tracker({ link_holder: { text: "Another copy" } }), msfsRunning: false })).toBe(false);
  });
});

/** Facts whose msfsRunning looks the test answers one by one. */
function heldFacts(): { msfsRunning(): Promise<boolean>; looks: number; answer(v: boolean): void } {
  const waiting: ((v: boolean) => void)[] = [];
  const f = {
    looks: 0,
    msfsRunning: () => {
      f.looks++;
      return new Promise<boolean>((resolve) => waiting.push(resolve));
    },
    answer: (v: boolean) => {
      const next = waiting.shift();
      if (!next) throw new Error("no look outstanding");
      next(v);
    },
  };
  return f;
}

const looks = (facts: FakeFacts) => facts.calls.filter((c) => c === "msfsRunning").length;

describe("MsfsWatch", () => {
  // @spec DESK-SHELL-AWAY-001, DESK-SHELL-SRV-037
  it("looks at once, then every 10 s on the monotonic clock", async () => {
    const clock = new FakeClock();
    const facts = new FakeFacts();
    const watch = new MsfsWatch(clock, facts);
    expect(watch.running()).toBe(false);
    watch.start();
    await flush();
    expect(looks(facts)).toBe(1);
    clock.setWall("2026-12-01T00:00:00.000Z");
    await clock.advance(9_999);
    expect(looks(facts)).toBe(1);
    await clock.advance(1);
    expect(looks(facts)).toBe(2);
    await clock.advance(10_000);
    expect(looks(facts)).toBe(3);
    await clock.advance(30_000);
    expect(looks(facts)).toBe(6);
    watch.stop();
  });

  // @spec DESK-SHELL-AWAY-001
  it("keeps the last look's answer for running()", async () => {
    const clock = new FakeClock();
    const facts = new FakeFacts();
    const watch = new MsfsWatch(clock, facts);
    watch.start();
    await flush();
    expect(watch.running()).toBe(false);
    facts.msfs = true;
    await clock.advance(10_000);
    expect(watch.running()).toBe(true);
    facts.msfs = false;
    await clock.advance(10_000);
    expect(watch.running()).toBe(false);
    watch.stop();
  });

  // @spec DESK-SHELL-AWAY-001
  it("skips a look that falls due while the last one is still outstanding", async () => {
    const clock = new FakeClock();
    const facts = heldFacts();
    const watch = new MsfsWatch(clock, facts);
    watch.start();
    await flush();
    expect(facts.looks).toBe(1);
    await clock.advance(20_000);
    expect(facts.looks).toBe(1);
    await clock.advance(5_000);
    facts.answer(true);
    await flush();
    expect(watch.running()).toBe(true);
    await clock.advance(5_000); // 30 s: the next look falls due with none outstanding
    expect(facts.looks).toBe(2);
    watch.stop();
  });

  // @spec DESK-SHELL-AWAY-001
  it("looks now at checkNow(), giving the answer and keeping it for running()", async () => {
    const clock = new FakeClock();
    const facts = new FakeFacts();
    const watch = new MsfsWatch(clock, facts);
    facts.msfs = true;
    expect(await watch.checkNow()).toBe(true);
    expect(looks(facts)).toBe(1);
    expect(watch.running()).toBe(true);
    facts.msfs = false;
    expect(await watch.checkNow()).toBe(false);
    expect(watch.running()).toBe(false);
  });

  // @spec DESK-SHELL-AWAY-001
  it("looks no more after stop(), holding no wait", async () => {
    const clock = new FakeClock();
    const facts = new FakeFacts();
    const watch = new MsfsWatch(clock, facts);
    watch.start();
    await flush();
    await clock.advance(10_000);
    watch.stop();
    expect(clock.pending()).toBe(0);
    await clock.advance(60_000);
    expect(looks(facts)).toBe(2);
  });

  // @spec DESK-SHELL-AWAY-001
  it("holds no wait after stop() with a look still outstanding", async () => {
    const clock = new FakeClock();
    const facts = heldFacts();
    const watch = new MsfsWatch(clock, facts);
    watch.start();
    await flush();
    watch.stop();
    expect(clock.pending()).toBe(0);
    facts.answer(true);
    await clock.advance(60_000);
    expect(facts.looks).toBe(1);
  });
});
