/**
 * Stopping tracking, the sim link's connection ending, and errors while tracking: the sim link
 * stopped by the server reaches the tracker as nothing at all (LIVE-LINK-011); an error in the
 * tracker's handling of one sample, sim event or disconnect leaves the link running
 * (LIVE-LINK-016); a connection that closes, fails or reports MSFS quitting keeps an airborne leg as
 * pending (LIVE-LEG-008), and only MSFS quitting switches casual mode off (LIVE-CASUAL-014); and
 * the tracker's final checkpoint at shutdown is its state from before the link stopped, with
 * nothing taken after it (LIVE-SAVE-005), casual mode switched off before it when the app is
 * quitting (LIVE-CASUAL-013).
 */
import { open } from "node-simconnect";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { startSimLink, type SimSample } from "../../src/server/simconnect.ts";
import { Tracker } from "../../src/server/tracker.ts";
import { FakeSimHandle, answerOpen, linkTracker, settle, simPilot } from "./fake-sim.ts";
import { pilot } from "./pilot.ts";
import { hopCount, rawCheckpoint, readCheckpoint, resetLogbook } from "./state.ts";

vi.mock("node-simconnect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node-simconnect")>()),
  open: vi.fn(),
}));

const LIVERY = "N1TP";

/** Let real time pass, for a reconnect the link might schedule (only Date is faked here). */
const realWait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Wait, in real time, until the link has connected the tracker again. */
async function reconnected(tr: Tracker): Promise<void> {
  for (let i = 0; i < 200 && !tr.status().connected; i++) await realWait(10);
  expect(tr.status().connected).toBe(true);
}

/** The latitudes of the samples a mocked onSample has been given, in order. */
const lats = (onSample: { mock: { calls: unknown[][] } }) => onSample.mock.calls.map(([s]) => (s as SimSample).lat);

/** Every handler the link can call, as plain mocks. */
function handlers() {
  return {
    onSample: vi.fn(),
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    onPause: vi.fn(),
    onSimRunning: vi.fn(),
    onFlightLoaded: vi.fn(),
    onLiveryUnsupported: vi.fn(),
  };
}

/**
 * A tracker linked to a fake sim, flown from the ground at KPVD into an airborne leg, the last
 * sample taken just after a checkpoint so the stored checkpoint lags the tracker by that sample.
 */
async function airborneOverLink() {
  const tr = new Tracker();
  const hd = new FakeSimHandle();
  answerOpen(hd);
  const link = linkTracker(tr);
  await settle();
  hd.livery(LIVERY);
  const f = simPilot(hd);
  f.ground(3);
  f.air(70);
  const saved = rawCheckpoint();
  for (let i = 0; i < 10 && rawCheckpoint() === saved; i++) f.air(1);
  f.air(1);
  return { tr, hd, link, f };
}

describe("stopping the sim link", () => {
  beforeEach(() => {
    vi.mocked(open).mockReset();
    // Any connection attempt beyond the answered ones waits forever, so a reconnect shows only as a call.
    vi.mocked(open).mockImplementation(() => new Promise(() => {}) as never);
    resetLogbook();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // @spec LIVE-LINK-011
  it("lets nothing the old connection still sends reach the tracker, so the airborne leg is saved as it was", async () => {
    const { tr, hd, link, f } = await airborneOverLink();
    try {
      const before = tr.status();
      expect(before.connected).toBe(true);
      expect(before.phase).toBe("airborne");
      expect(before.leg).not.toBeNull();

      link.stop();
      // What a real handle may still send after its close(): the close itself, a quit, an error,
      // data already on its way, and sim events. The data comes 10 s on, so a sample taken would add a point.
      vi.setSystemTime(Date.now() + 10_000);
      hd.lose();
      hd.quit();
      hd.fail();
      hd.position({ ...f.position, on_ground: false });
      hd.frame({ on_ground: true, vs_fpm: -400, g: 1.8, ias_kts: 60 });
      hd.systemEvent("Pause", true);
      hd.flightLoaded();
      await settle();

      const st = tr.status();
      expect(st.connected).toBe(true);
      expect(st.phase).toBe("airborne");
      expect(st.leg).toEqual(before.leg);
      expect(st.position).toEqual(before.position);
      expect(st.pending).toEqual([]);
      expect(st.paused).toBe(false);
      expect(st.message ?? "").not.toMatch(/disconnect|Discarded/i);

      tr.saveNow();
      const saved = readCheckpoint();
      expect(saved?.phase).toBe("airborne");
      expect(saved?.leg?.departed_at).toBe(Date.parse(before.leg!.departed_at));
      expect(saved?.leg?.track).toHaveLength(before.leg!.points);
    } finally {
      link.stop();
    }
  });

  // @spec LIVE-LINK-011
  it("calls no handler for anything the old handle emits once stopped, its own close included, and never reconnects", async () => {
    const h = handlers();
    const hd = new FakeSimHandle();
    // A handle whose close() reports the close at once.
    hd.close.mockImplementation(() => {
      hd.emit("close");
    });
    answerOpen(hd);
    const link = startSimLink(h, { retryMs: 10 });
    try {
      await settle();
      expect(h.onConnect).toHaveBeenCalledTimes(1);
      // A sample held for the livery, not yet passed on.
      hd.position({ lat: 41.70 });
      expect(h.onSample).not.toHaveBeenCalled();

      link.stop();
      expect(hd.close).toHaveBeenCalled();
      hd.livery(LIVERY);
      hd.position({ lat: 41.71 });
      hd.frame({ on_ground: true, vs_fpm: -400, g: 1.8, ias_kts: 60 });
      hd.systemEvent("Pause", true);
      hd.systemEvent("Sim", false);
      hd.flightLoaded();
      hd.rejectLivery();
      hd.lose();
      hd.quit();
      hd.fail();
      await settle();
      await realWait(80);

      expect(h.onSample).not.toHaveBeenCalled();
      expect(h.onDisconnect).not.toHaveBeenCalled();
      expect(h.onPause).not.toHaveBeenCalled();
      expect(h.onSimRunning).not.toHaveBeenCalled();
      expect(h.onFlightLoaded).not.toHaveBeenCalled();
      expect(h.onLiveryUnsupported).not.toHaveBeenCalled();
      expect(vi.mocked(open)).toHaveBeenCalledTimes(1);
    } finally {
      link.stop();
    }
  });

  // @spec LIVE-LINK-011
  it("closes, unseen, a connection that opens only after the link stopped, and never reconnects", async () => {
    const h = { ...handlers(), log: vi.fn() };
    const hd = new FakeSimHandle();
    let answer!: (v: unknown) => void;
    vi.mocked(open).mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)) as never);
    const link = startSimLink(h, { retryMs: 10 });
    link.stop();
    link.stop();

    answer({ recvOpen: { applicationName: "Fake MSFS" }, handle: hd });
    await settle();
    hd.lose();
    hd.quit();
    await realWait(80);

    expect(hd.close).toHaveBeenCalled();
    expect(h.onConnect).not.toHaveBeenCalled();
    expect(h.onDisconnect).not.toHaveBeenCalled();
    expect(h.log).not.toHaveBeenCalled();
    expect(link.connected()).toBe(false);
    expect(vi.mocked(open)).toHaveBeenCalledTimes(1);
  });

  // @spec LIVE-LINK-011
  it("writes nothing out and never reconnects when a connection attempt fails after the link stopped", async () => {
    const h = { ...handlers(), log: vi.fn() };
    let refuse!: (e: unknown) => void;
    vi.mocked(open).mockImplementationOnce(() => new Promise((_, reject) => (refuse = reject)) as never);
    const link = startSimLink(h, { retryMs: 10 });
    link.stop();

    refuse(new Error("sim not reachable"));
    await settle();
    await realWait(80);

    expect(h.log).not.toHaveBeenCalled();
    expect(h.onConnect).not.toHaveBeenCalled();
    expect(h.onDisconnect).not.toHaveBeenCalled();
    expect(vi.mocked(open)).toHaveBeenCalledTimes(1);
  });

  // @spec LIVE-LINK-011
  it("drops the reconnect it was waiting to make when stopped", async () => {
    const h = { ...handlers(), log: vi.fn() };
    vi.mocked(open).mockRejectedValueOnce(new Error("sim not reachable"));
    const link = startSimLink(h, { retryMs: 30 });
    await settle();
    // The first failed attempt is written out; the next would follow 30 ms on.
    expect(h.log).toHaveBeenCalledTimes(1);

    link.stop();
    await realWait(100);

    expect(vi.mocked(open)).toHaveBeenCalledTimes(1);
    expect(h.onConnect).not.toHaveBeenCalled();
  });
});

describe("an error in the tracker's handling of a sample, sim event or disconnect", () => {
  let errors: MockInstance<typeof console.error>;

  beforeEach(() => {
    vi.mocked(open).mockReset();
    vi.mocked(open).mockImplementation(() => new Promise(() => {}) as never);
    resetLogbook();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
    errors = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errors.mockRestore();
    vi.useRealTimers();
  });

  /** Whether the error was written out: a console.error call with the error, or its message, among its arguments. */
  const wroteOut = (err: Error) => errors.mock.calls.some((args) => args.some((a) => a === err || String(a).includes(err.message)));

  // @spec LIVE-LINK-016
  it("is written out and the next sample, held ones included, still reaches the tracker over the same connection", async () => {
    const boom = new Error("boom");
    const h = handlers();
    h.onSample.mockImplementationOnce(() => {
      throw boom;
    });
    const hd = new FakeSimHandle();
    answerOpen(hd);
    const link = startSimLink(h, { retryMs: 10 });
    try {
      await settle();
      hd.position({ lat: 41.70 });
      hd.position({ lat: 41.71 });

      expect(() => hd.livery("L")).not.toThrow();
      expect(lats(h.onSample)).toEqual([41.70, 41.71]);
      expect(wroteOut(boom)).toBe(true);

      hd.position({ lat: 41.72 });
      expect(lats(h.onSample)).toEqual([41.70, 41.71, 41.72]);
      expect(link.connected()).toBe(true);
      expect(h.onDisconnect).not.toHaveBeenCalled();
    } finally {
      link.stop();
    }
  });

  // @spec LIVE-LINK-016
  it("in a sample after the livery is known is written out and the next sample still reaches the tracker over the same connection", async () => {
    const boom = new Error("sample failed");
    const h = handlers();
    const hd = new FakeSimHandle();
    answerOpen(hd);
    const link = startSimLink(h, { retryMs: 10 });
    try {
      await settle();
      hd.livery("L");
      h.onSample.mockImplementationOnce(() => {
        throw boom;
      });

      expect(() => hd.position({ lat: 41.70 })).not.toThrow();
      expect(wroteOut(boom)).toBe(true);

      hd.position({ lat: 41.71 });
      expect(lats(h.onSample)).toEqual([41.70, 41.71]);
      expect(link.connected()).toBe(true);
      expect(h.onDisconnect).not.toHaveBeenCalled();
    } finally {
      link.stop();
    }
  });

  // @spec LIVE-LINK-016
  it("in a sim event is written out and the next event still reaches the tracker", async () => {
    const boom = new Error("pause failed");
    const h = handlers();
    h.onPause.mockImplementationOnce(() => {
      throw boom;
    });
    const hd = new FakeSimHandle();
    answerOpen(hd);
    const link = startSimLink(h, { retryMs: 10 });
    try {
      await settle();
      expect(() => hd.systemEvent("Pause", true)).not.toThrow();
      expect(wroteOut(boom)).toBe(true);

      hd.systemEvent("Pause", false);
      expect(h.onPause.mock.calls).toEqual([[true], [false]]);
      expect(link.connected()).toBe(true);
      expect(h.onDisconnect).not.toHaveBeenCalled();
    } finally {
      link.stop();
    }
  });

  // @spec LIVE-LINK-016
  it("on connecting is written out, keeps the connection and schedules no retry", async () => {
    const boom = new Error("connect failed");
    const h = handlers();
    h.onConnect.mockImplementationOnce(() => {
      throw boom;
    });
    const hd = new FakeSimHandle();
    answerOpen(hd);
    const link = startSimLink(h, { retryMs: 10 });
    try {
      await settle();
      expect(h.onConnect).toHaveBeenCalledTimes(1);

      hd.livery("L");
      hd.position({ lat: 41.70 });
      expect(lats(h.onSample)).toEqual([41.70]);
      expect(link.connected()).toBe(true);
      expect(hd.close).not.toHaveBeenCalled();
      expect(h.onDisconnect).not.toHaveBeenCalled();

      await realWait(80);
      expect(vi.mocked(open)).toHaveBeenCalledTimes(1);
      expect(wroteOut(boom)).toBe(true);
    } finally {
      link.stop();
    }
  });

  // @spec LIVE-LINK-016
  it("on a disconnect is written out and the link still connects again", async () => {
    const boom = new Error("disconnect failed");
    const h = handlers();
    h.onDisconnect.mockImplementationOnce(() => {
      throw boom;
    });
    const first = new FakeSimHandle();
    const second = new FakeSimHandle();
    answerOpen(first, second);
    const link = startSimLink(h, { retryMs: 10 });
    try {
      await settle();
      expect(h.onConnect).toHaveBeenCalledTimes(1);

      expect(() => first.lose()).not.toThrow();
      expect(wroteOut(boom)).toBe(true);

      for (let i = 0; i < 200 && h.onConnect.mock.calls.length < 2; i++) await realWait(10);
      expect(vi.mocked(open)).toHaveBeenCalledTimes(2);
      expect(h.onConnect).toHaveBeenCalledTimes(2);
      expect(link.connected()).toBe(true);
    } finally {
      link.stop();
    }
  });
});

describe("the sim link's connection ending", () => {
  beforeEach(() => {
    vi.mocked(open).mockReset();
    vi.mocked(open).mockImplementation(() => new Promise(() => {}) as never);
    resetLogbook();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // @spec LIVE-LEG-008
  it.each([
    ["closes", (hd: FakeSimHandle) => hd.lose()],
    ["fails", (hd: FakeSimHandle) => hd.fail()],
    ["reports MSFS quitting", (hd: FakeSimHandle) => hd.quit()],
  ])("keeps an airborne leg as a pending leg ending at the last sample when the connection %s", async (_, end) => {
    const { tr, hd, link } = await airborneOverLink();
    try {
      const flying = tr.status();
      expect(flying.phase).toBe("airborne");
      expect(flying.leg?.origin).toBe("KPVD");

      end(hd);
      const st = tr.status();
      expect(st.connected).toBe(false);
      expect(st.leg).toBeNull();
      expect(hopCount()).toBe(0);
      expect(st.pending).toHaveLength(1);
      expect(st.pending[0]).toMatchObject({
        origin: "KPVD",
        dest: null,
        departed_at: flying.leg!.departed_at,
        arrived_at: flying.position!.t,
        reason: "the sim disconnected in flight",
      });
    } finally {
      link.stop();
    }
  });

  // @spec LIVE-CASUAL-014
  it("leaves casual mode and its path on when the connection closes or fails, and switches it off when MSFS quits", async () => {
    const tr = new Tracker();
    const [closes, fails, quits] = [new FakeSimHandle(), new FakeSimHandle(), new FakeSimHandle()];
    answerOpen(closes, fails, quits);
    const link = linkTracker(tr, { retryMs: 10 });
    try {
      await settle();
      expect(tr.status().connected).toBe(true);
      closes.livery(LIVERY);
      tr.setCasual(true);
      const since = tr.status().casual?.since;
      expect(since).toBeTruthy();
      simPilot(closes).air(12);
      expect(tr.path().length).toBeGreaterThan(0);

      // A sim crash or a lost connection: casual mode and its path stay.
      closes.lose();
      expect(tr.status().connected).toBe(false);
      expect(tr.status().casual?.since).toBe(since);
      expect(tr.path().length).toBeGreaterThan(0);

      await reconnected(tr);
      fails.fail();
      expect(tr.status().connected).toBe(false);
      expect(tr.status().casual?.since).toBe(since);
      expect(tr.path().length).toBeGreaterThan(0);

      // SimConnect's quit event: MSFS closed normally.
      await reconnected(tr);
      quits.quit();
      const st = tr.status();
      expect(st.connected).toBe(false);
      expect(st.casual).toBeNull();
      expect(tr.path()).toEqual([]);
      expect(st.message).toBe("Casual mode off (MSFS closed): takeoffs and landings are logged again");
    } finally {
      link.stop();
    }
  });

  // @spec LIVE-LINK-007, LIVE-CASUAL-014
  it("reports MSFS quitting as one disconnect, not followed by the close it brings on, and lets nothing the ended connection still sends through after reconnecting", async () => {
    const h = handlers();
    const first = new FakeSimHandle();
    // A handle whose close() reports the close at once, as the real one does.
    first.close.mockImplementation(() => {
      first.emit("close");
    });
    const second = new FakeSimHandle();
    answerOpen(first, second);
    const link = startSimLink(h, { retryMs: 10 });
    try {
      await settle();
      first.livery(LIVERY);
      first.quit();
      expect(first.close).toHaveBeenCalled();
      expect(h.onDisconnect.mock.calls).toEqual([["the simulator quit", true]]);

      for (let i = 0; i < 200 && h.onConnect.mock.calls.length < 2; i++) await realWait(10);
      expect(h.onConnect).toHaveBeenCalledTimes(2);

      // What the ended connection may still send once the next one is open.
      first.livery("Red");
      first.position({ lat: 41.71 });
      first.lose();
      first.fail();
      first.quit();
      // Long enough for a second reconnect, had the close brought one on.
      await realWait(80);

      expect(h.onSample).not.toHaveBeenCalled();
      expect(h.onDisconnect).toHaveBeenCalledTimes(1);
      expect(link.connected()).toBe(true);
      expect(vi.mocked(open)).toHaveBeenCalledTimes(2);
    } finally {
      link.stop();
    }
  });
});

describe("the tracker at shutdown", () => {
  beforeEach(() => {
    vi.mocked(open).mockReset();
    vi.mocked(open).mockImplementation(() => new Promise(() => {}) as never);
    resetLogbook();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // @spec LIVE-SAVE-005
  it("writes its final checkpoint after the link has stopped, holding the airborne leg as it was, which the next start restores", async () => {
    const { tr, hd, link } = await airborneOverLink();
    try {
      const before = tr.status();
      expect(before.phase).toBe("airborne");

      link.stop();
      hd.lose();
      await settle();
      tr.shutdown({ quitting: false });

      const saved = readCheckpoint();
      expect(saved?.phase).toBe("airborne");
      expect(saved?.leg?.departed_at).toBe(Date.parse(before.leg!.departed_at));
      expect(saved?.leg?.track).toHaveLength(before.leg!.points);

      const restored = new Tracker().status();
      expect(restored.phase).toBe("airborne");
      expect(restored.leg).toEqual(before.leg);
      expect(restored.position).toEqual(before.position);
    } finally {
      link.stop();
    }
  });

  // @spec LIVE-SAVE-005
  it("takes no sample or sim event after its final checkpoint", async () => {
    const { tr, hd, link, f } = await airborneOverLink();
    try {
      link.stop();
      hd.lose();
      await settle();
      tr.shutdown({ quitting: false });
      const raw = rawCheckpoint();
      const after = tr.status();
      expect(after.phase).toBe("airborne");

      // 10 s on and on the ground: taken, it would add a point and touch down.
      const s: SimSample = { ...f.position, t: Date.now() + 10_000, on_ground: true, gs_kts: 40, alt_ft: 55, livery: LIVERY };
      vi.setSystemTime(s.t);
      tr.feed(s);
      tr.setConnected(false);
      tr.setPaused(true);
      tr.setSimRunning(false);
      tr.setLiverySupported(false);
      tr.flightLoaded("x");

      expect(rawCheckpoint()).toBe(raw);
      expect(tr.status()).toEqual(after);
    } finally {
      link.stop();
    }
  });

  // @spec LIVE-SAVE-005, LIVE-CASUAL-013
  it("switches casual mode off before its final checkpoint when the app is quitting, and leaves it on otherwise", () => {
    const quitting = new Tracker();
    quitting.setConnected(true, "Fake MSFS");
    const p = pilot(quitting);
    quitting.setCasual(true);
    p.ground(3);
    p.air(20);
    quitting.shutdown({ quitting: true });
    expect(quitting.status().casual).toBeNull();
    expect(readCheckpoint()?.casual ?? null).toBeNull();
    expect(new Tracker().status().casual).toBeNull();

    resetLogbook();
    const staying = new Tracker();
    staying.setConnected(true, "Fake MSFS");
    p.use(staying);
    staying.setCasual(true);
    const since = staying.status().casual?.since;
    p.air(20);
    staying.shutdown({ quitting: false });
    expect(new Tracker().status().casual?.since).toBe(since);
  });
});
