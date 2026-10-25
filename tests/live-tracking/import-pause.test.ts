/**
 * Tracking paused while a logbook is brought in (LIVE-LINK-017, LIVE-API-015): the link stopped as
 * at shutdown, with nothing reaching the tracker and the sim-link claim released; the tracker taking
 * no sample or sim event and turning down every change; and, after an import that failed before its
 * answer, tracking resumed from the state it was paused in.
 */
import { randomUUID } from "node:crypto";
import net from "node:net";
import { open } from "node-simconnect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ImportUnderWay, Tracker } from "../../src/server/tracker.ts";
import { startTracking, type Tracking } from "../../src/server/tracking.ts";
import { FakeSimHandle, answerOpen, settle, simPilot } from "./fake-sim.ts";
import { KPVD, fleetAircraft, pilot, takeOff } from "./pilot.ts";
import { addBriefing, resetLogbook } from "./state.ts";

vi.mock("node-simconnect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node-simconnect")>()),
  open: vi.fn(),
}));

const privatePipe = () => `\\\\.\\pipe\\msfs-career-map-sim-link-test-${process.pid}-${randomUUID()}`;
const realWait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out");
    await realWait(10);
  }
}
/** Whether something listens on the pipe. */
const held = (pipe: string) =>
  new Promise<boolean>((resolve) => {
    const s = net.connect(pipe);
    s.on("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.on("error", () => resolve(false));
  });

let started: Tracking[] = [];
beforeEach(() => {
  vi.mocked(open).mockReset();
  vi.mocked(open).mockImplementation(() => new Promise(() => {}) as never);
  resetLogbook();
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  for (const t of started) t.stop();
  started = [];
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the tracker while a logbook is brought in (LIVE-LINK-017, LIVE-API-015)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  // @spec LIVE-LINK-017
  it("takes no sample or sim event while paused, and goes on from where it was once resumed", () => {
    fleetAircraft();
    const tr = new Tracker();
    tr.setConnected(true, "Fake MSFS");
    const p = pilot(tr);
    takeOff(p);
    p.air(20);
    const before = tr.status();

    tr.pauseForImport();
    expect(tr.isPausedForImport()).toBe(true);
    p.air(30);
    p.feed({ on_ground: true, gs_kts: 0 });
    tr.setPaused(true);
    tr.setSimRunning(false);
    tr.flightLoaded("C:\\flights\\other.FLT");
    tr.setLiverySupported(false);
    tr.setConnected(false);
    const during = tr.status();
    expect(during).toMatchObject({ connected: true, paused: false, sim_running: true, livery_supported: true, phase: "airborne", pending: [] });
    expect(during.leg).toEqual(before.leg);
    expect(during.position).toEqual(before.position);

    tr.resumeAfterImport();
    expect(tr.isPausedForImport()).toBe(false);
    p.moveTo(KPVD);
    p.air(5);
    expect(tr.status().phase).toBe("airborne");
    expect(tr.status().leg?.departed_at).toBe(before.leg?.departed_at);
    expect(tr.status().leg!.points).toBeGreaterThanOrEqual(before.leg!.points);
  });

  // @spec LIVE-API-015
  it("turns down every change to its state with ImportUnderWay, changing nothing, while reads answer as usual", () => {
    const plane = fleetAircraft();
    const tr = new Tracker();
    tr.setConnected(true, "Fake MSFS");
    const p = pilot(tr);
    takeOff(p);
    tr.setCasual(false);
    const before = JSON.stringify(tr.status());
    tr.pauseForImport();
    const actions: [string, () => unknown][] = [
      ["bind", () => tr.bind(plane)],
      ["setBriefing", () => tr.setBriefing(addBriefing())],
      ["setBriefing(null)", () => tr.setBriefing(null)],
      ["setCasual", () => tr.setCasual(true, { dropLeg: true })],
      ["discardLeg", () => tr.discardLeg("test")],
      ["completeNow", () => tr.completeNow()],
      ["savePending", () => tr.savePending(randomUUID(), { aircraft_id: plane })],
      ["discardPending", () => tr.discardPending(randomUUID())],
      ["clearPath", () => tr.clearPath()],
    ];
    for (const [name, act] of actions) {
      let thrown: unknown;
      try {
        act();
      } catch (e) {
        thrown = e;
      }
      expect(thrown, name).toBeInstanceOf(ImportUnderWay);
      expect((thrown as Error).message, name).toBe("Bringing in a logbook");
    }
    expect(JSON.stringify(tr.status())).toBe(before);
    expect(tr.track().length).toBeGreaterThan(0);
  });
});

describe("the import's 409 and the shutdown's 503 (LIVE-API-016)", () => {
  // @spec LIVE-API-016, LIVE-API-015
  it("turns an action down as bringing in a logbook, not as shutting down, once both apply", () => {
    const tr = new Tracker();
    tr.pauseForImport();
    tr.shutdown({ quitting: false });
    expect(() => tr.discardLeg("test")).toThrow(ImportUnderWay);
    expect(() => tr.setCasual(true)).toThrow(ImportUnderWay);
  });
});

describe("the link while a logbook is brought in (LIVE-LINK-017)", () => {
  // @spec LIVE-LINK-017, LIVE-LINK-011
  it("stops the link with nothing reaching the tracker and the claim released, then starts it again on resume", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-25T12:00:00Z"));
    fleetAircraft();
    const pipe = privatePipe();
    const tr = new Tracker();
    const first = new FakeSimHandle();
    const second = new FakeSimHandle();
    answerOpen(first, second);
    const t = startTracking(tr, { sim: "link", simHost: null, simPort: null, retryMs: 60_000, claimPipe: pipe });
    started.push(t);
    await until(() => tr.status().connected);
    first.livery("N1TC");
    const f = simPilot(first, { title: "Test Comanche", atc_id: "N1TC" });
    f.ground(3);
    f.air(20);
    expect(tr.status().phase).toBe("airborne");
    expect(await held(pipe)).toBe(true);
    const before = tr.status();

    tr.pauseForImport();
    t.pause();
    expect(first.close).toHaveBeenCalled();
    first.lose();
    first.quit();
    await settle();
    await realWait(20);
    expect(await held(pipe)).toBe(false);
    expect(tr.status().pending).toEqual([]);
    expect(tr.status().leg).toEqual(before.leg);
    expect(vi.mocked(open)).toHaveBeenCalledTimes(1);

    tr.resumeAfterImport();
    t.resume();
    await until(() => vi.mocked(open).mock.calls.length === 2);
    await settle();
    second.livery("N1TC");
    const g = simPilot(second, { ...f.position, title: "Test Comanche", atc_id: "N1TC" });
    g.air(5);
    expect(tr.status().phase).toBe("airborne");
    expect(tr.status().leg?.departed_at).toBe(before.leg?.departed_at);
    expect(await held(pipe)).toBe(true);
  });

  // @spec LIVE-LINK-017
  it.each<["fake" | "off"]>([["fake"], ["off"]])("pauses and resumes in sim mode %s with no link to stop or start", async (sim) => {
    const tr = new Tracker();
    const t = startTracking(tr, { sim, simHost: null, simPort: null, claimPipe: privatePipe() });
    started.push(t);
    expect(() => {
      t.pause();
      t.resume();
    }).not.toThrow();
    await realWait(20);
    expect(open).not.toHaveBeenCalled();
    expect(tr.status().sim_mode).toBe(sim);
  });
});
