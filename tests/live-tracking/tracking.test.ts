/**
 * Starting tracking in the server's sim mode (startTracking; LIVE-LINK-012, LIVE-LINK-013,
 * LIVE-LINK-002, LIVE-LINK-003): the sim link only on `link`, nothing started on `fake` or `off`,
 * each with its line; the status's `sim_mode`, and `sim_host` null for a host that names this PC
 * (isThisPc; LIVE-API-013); the link's stop, disconnects and quit reaching the tracker as 1a wired
 * them (LIVE-LINK-011, LIVE-LEG-008, LIVE-CASUAL-014); and the sample route taking its sim mode from
 * the tracker, never from TRACKER_FAKE (LIVE-API-004).
 *
 * No test opens the PC-wide sim-link pipe: each passes a private `claimPipe`.
 */
import { randomUUID } from "node:crypto";
import os from "node:os";
import { open } from "node-simconnect";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { isThisPc } from "../../src/server/this-pc.ts";
import { Tracker, tracker, type SimMode } from "../../src/server/tracker.ts";
import { startTracking, type Tracking } from "../../src/server/tracking.ts";
import { startTestServer, type TestServer } from "../support/test-server.ts";
import { FakeSimHandle, answerOpen, settle, simPilot } from "./fake-sim.ts";
import { resetLogbook } from "./state.ts";

vi.mock("node-simconnect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node-simconnect")>()),
  open: vi.fn(),
}));

const LIVERY = "N1TP";
const OFF_LINE = "[sim] tracking off: start with --sim=link to track flights from MSFS";
const FAKE_LINE = "[sim] fake feed: POST /api/tracker/sample feeds the tracker (npm run sim-fake)";

/** A sim-link pipe name of this test's own, never the PC-wide one. */
const privatePipe = () => `\\\\.\\pipe\\msfs-career-map-sim-link-test-${process.pid}-${randomUUID()}`;

const HOSTNAME = os.hostname();
const LISTED = Object.values(os.networkInterfaces()).flatMap((list) => list ?? []);
/** The first IPv4 address this PC lists. */
const FIRST_IPV4 = LISTED.find((a) => a.family === "IPv4")?.address ?? "127.0.0.1";

/** Let real time pass, for a reconnect the link schedules (only Date is faked here). */
const realWait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The options `open` was given on its nth call. */
const openOptions = (n = 0) => vi.mocked(open).mock.calls[n]?.[2] as { remote?: { host: string; port: number } } | undefined;

let logs: MockInstance<typeof console.log>;
/** The `[sim]` lines written with console.log, in order. */
const simLines = () => logs.mock.calls.map((args) => args.map(String).join(" ")).filter((l) => l.startsWith("[sim]"));

let started: Tracking[] = [];

/** startTracking with a link that retries only after a minute unless told otherwise, and a private pipe. */
function start(tr: Tracker, o: { sim?: SimMode; simHost?: string | null; simPort?: number | null; retryMs?: number } = {}): Tracking {
  const t = startTracking(tr, { sim: "link", simHost: null, simPort: null, retryMs: 60_000, ...o, claimPipe: privatePipe() });
  started.push(t);
  return t;
}

beforeEach(() => {
  vi.mocked(open).mockReset();
  // Any connection attempt beyond the answered ones waits forever.
  vi.mocked(open).mockImplementation(() => new Promise(() => {}) as never);
  resetLogbook();
  logs = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  for (const t of started) t.stop();
  started = [];
  logs.mockRestore();
  vi.useRealTimers();
});

describe("starting tracking in each sim mode", () => {
  // @spec LIVE-LINK-003, LIVE-LINK-012, LIVE-LINK-013, LIVE-API-013
  it.each<[SimMode, string]>([
    ["off", OFF_LINE],
    ["fake", FAKE_LINE],
  ])("in sim mode %s starts no link, reports the mode with no sim host, and writes its line", async (sim, line) => {
    const tr = new Tracker();
    // A host given without the link is no sim host.
    const t = start(tr, { sim, simHost: "192.0.2.20", simPort: 500 });
    await settle();

    expect(open).not.toHaveBeenCalled();
    expect(tr.status()).toMatchObject({ sim_mode: sim, sim_host: null, connected: false });
    expect(t.connected()).toBe(false);
    expect(simLines()).toEqual([line]);

    expect(() => {
      t.stop();
      t.stop();
    }).not.toThrow();
    await realWait(30);
    expect(open).not.toHaveBeenCalled();
    expect(tr.status()).toMatchObject({ sim_mode: sim, sim_host: null, connected: false });
    expect(t.connected()).toBe(false);
    expect(simLines()).toEqual([line]);
  });

  // @spec LIVE-LINK-012, LIVE-LINK-013, LIVE-API-013
  it("in sim mode link opens the link once, with no remote option when no host is given, and reports no sim host", async () => {
    const tr = new Tracker();
    const t = start(tr);
    await settle();

    expect(open).toHaveBeenCalledTimes(1);
    expect(openOptions()?.remote).toBeUndefined();
    expect(tr.status()).toMatchObject({ sim_mode: "link", sim_host: null });
    // The attempt never answers: nothing is connected and no off or fake line is written.
    expect(t.connected()).toBe(false);
    expect(simLines()).toEqual([]);
  });

  // @spec LIVE-LINK-002, LIVE-API-013
  it.each<[string, number | null, number]>([
    ["192.0.2.20", 500, 500],
    ["192.0.2.20", 4321, 4321],
    ["192.0.2.20", null, 500],
    ["simpc.example.com", 500, 500],
  ])("with sim host %s and port %s opens the link to that host on port %s and reports it as the sim host", async (host, port, expected) => {
    const tr = new Tracker();
    start(tr, { simHost: host, simPort: port });
    await settle();

    expect(open).toHaveBeenCalledTimes(1);
    expect(openOptions()).toEqual({ remote: { host, port: expected } });
    expect(tr.status()).toMatchObject({ sim_mode: "link", sim_host: host });
  });

  // @spec LIVE-LINK-002, LIVE-API-013
  it.each(["127.0.0.1", "localhost", "::1", HOSTNAME, HOSTNAME.toUpperCase(), HOSTNAME.toLowerCase(), FIRST_IPV4])(
    "with sim host %s, which names this PC, still opens the link to it but reports no sim host",
    async (host) => {
      const tr = new Tracker();
      start(tr, { simHost: host, simPort: null });
      await settle();

      expect(open).toHaveBeenCalledTimes(1);
      expect(openOptions()).toEqual({ remote: { host, port: 500 } });
      expect(tr.status()).toMatchObject({ sim_mode: "link", sim_host: null });
    },
  );

  // @spec LIVE-LINK-012, LIVE-LINK-013
  it("reads no environment variable: the sim mode, host and port come from its options alone", async () => {
    const names = ["TRACKER_FAKE", "TRACKER", "SIMCONNECT_HOST", "SIMCONNECT_PORT"] as const;
    const saved = Object.fromEntries(names.map((n) => [n, process.env[n]]));
    Object.assign(process.env, { TRACKER_FAKE: "1", TRACKER: "0", SIMCONNECT_HOST: "192.0.2.99", SIMCONNECT_PORT: "4321" });
    try {
      const off = new Tracker();
      start(off, { sim: "off" });
      await settle();
      expect(open).not.toHaveBeenCalled();
      expect(off.status()).toMatchObject({ sim_mode: "off", sim_host: null });

      const linked = new Tracker();
      start(linked, { sim: "link" });
      await settle();
      expect(open).toHaveBeenCalledTimes(1);
      expect(openOptions()?.remote).toBeUndefined();
      expect(linked.status()).toMatchObject({ sim_mode: "link", sim_host: null });

      expect(simLines()).toEqual([OFF_LINE]);
    } finally {
      for (const n of names) {
        if (saved[n] === undefined) delete process.env[n];
        else process.env[n] = saved[n];
      }
    }
  });
});

describe("isThisPc", () => {
  // @spec LIVE-API-013
  it.each([
    "127.0.0.1",
    "127.0.0.2",
    "127.255.255.254",
    "localhost",
    "LOCALHOST",
    "  localhost  ",
    "::1",
    "[::1]",
    HOSTNAME,
    HOSTNAME.toUpperCase(),
    HOSTNAME.toLowerCase(),
    `${HOSTNAME}.example.lan`,
    `${HOSTNAME.toUpperCase()}.HOME.LAN`,
    FIRST_IPV4,
  ])("takes %s for this PC", (host) => {
    expect(isThisPc(host)).toBe(true);
  });

  // @spec LIVE-API-013
  it.each([
    "192.0.2.1",
    "example.com",
    "128.0.0.1",
    "127.0.0.1.example.com",
    "::2",
    `${HOSTNAME}2`,
    `x${HOSTNAME}`,
    `example.${HOSTNAME}`,
  ])("takes %s for another PC", (host) => {
    expect(isThisPc(host)).toBe(false);
  });

  // @spec LIVE-API-013
  it("takes every address this PC lists for this PC, in brackets, in upper case and with an IPv6 zone", () => {
    expect(LISTED.length).toBeGreaterThan(0);
    for (const { address, family } of LISTED) {
      expect(isThisPc(address), address).toBe(true);
      if (family !== "IPv6") continue;
      expect(isThisPc(`[${address}]`), `[${address}]`).toBe(true);
      expect(isThisPc(address.toUpperCase()), address.toUpperCase()).toBe(true);
      expect(isThisPc(`${address}%7`), `${address}%7`).toBe(true);
    }
  });
});

describe("the link startTracking starts", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-24T12:00:00Z"));
  });

  /** A tracker linked through startTracking, connected, the livery read. */
  async function linked(o: { retryMs?: number } = {}, ...handles: FakeSimHandle[]) {
    const tr = new Tracker();
    answerOpen(...handles);
    const t = start(tr, o);
    await settle();
    expect(tr.status()).toMatchObject({ connected: true, sim_name: "Fake MSFS" });
    expect(t.connected()).toBe(true);
    handles[0].livery(LIVERY);
    return { tr, t };
  }

  /** Wait, in real time, until the link has connected the tracker again. */
  async function reconnected(tr: Tracker): Promise<void> {
    for (let i = 0; i < 200 && !tr.status().connected; i++) await realWait(10);
    expect(tr.status().connected).toBe(true);
  }

  // @spec LIVE-LINK-013, LIVE-LINK-011
  it("writes the connection, and stop() closes the handle leaving an airborne leg as it was: no disconnect reaches the tracker and no pending leg appears", async () => {
    const hd = new FakeSimHandle();
    const { tr, t } = await linked({}, hd);
    expect(simLines()).toEqual(["[sim] connected to Fake MSFS"]);
    const f = simPilot(hd);
    f.ground(3);
    f.air(70);
    const before = tr.status();
    expect(before.phase).toBe("airborne");

    t.stop();
    expect(hd.close).toHaveBeenCalled();
    // What the real handle may still send once closed.
    hd.lose();
    hd.quit();
    await settle();

    const st = tr.status();
    expect(st.connected).toBe(true);
    expect(st.phase).toBe("airborne");
    expect(st.leg).toEqual(before.leg);
    expect(st.pending).toEqual([]);
    expect(t.connected()).toBe(false);
    expect(simLines()).toEqual(["[sim] connected to Fake MSFS"]);
    expect(open).toHaveBeenCalledTimes(1);
  });

  // @spec LIVE-LEG-008
  it("keeps an airborne leg as pending, with the reason the sim disconnected in flight, when the connection closes, and writes the disconnect", async () => {
    const hd = new FakeSimHandle();
    const { tr } = await linked({}, hd);
    const f = simPilot(hd);
    f.ground(3);
    f.air(70);
    expect(tr.status().phase).toBe("airborne");

    hd.lose();
    const st = tr.status();
    expect(st.connected).toBe(false);
    expect(st.leg).toBeNull();
    expect(st.pending).toHaveLength(1);
    expect(st.pending[0]).toMatchObject({ origin: "KPVD", dest: null, reason: "the sim disconnected in flight" });
    expect(simLines()).toEqual(["[sim] connected to Fake MSFS", "[sim] disconnected: the connection closed"]);
  });

  // @spec LIVE-CASUAL-014
  it("leaves casual mode on when the connection closes, and switches it off with its message when MSFS quits", async () => {
    const closes = new FakeSimHandle();
    const quits = new FakeSimHandle();
    const { tr } = await linked({ retryMs: 10 }, closes, quits);
    tr.setCasual(true);
    const since = tr.status().casual?.since;
    expect(since).toBeTruthy();

    closes.lose();
    expect(tr.status().connected).toBe(false);
    expect(tr.status().casual?.since).toBe(since);

    await reconnected(tr);
    quits.quit();
    const st = tr.status();
    expect(st.connected).toBe(false);
    expect(st.casual).toBeNull();
    expect(st.message).toBe("Casual mode off (MSFS closed): takeoffs and landings are logged again");
    expect(simLines()).toEqual([
      "[sim] connected to Fake MSFS",
      "[sim] disconnected: the connection closed",
      "[sim] connected to Fake MSFS",
      "[sim] disconnected: the simulator quit",
    ]);
  });

  // @spec LIVE-LINK-013
  it("writes what the link reports, with [sim] in front", async () => {
    vi.mocked(open).mockRejectedValueOnce(new Error("no sim here"));
    const tr = new Tracker();
    start(tr);
    await settle();
    // The link's own words are simconnect.ts's; the wiring writes them as one line with [sim] in front.
    expect(simLines()).toHaveLength(1);
    expect(simLines()[0]).toMatch(/^\[sim\] \S.*no sim here/);
    expect(tr.status()).toMatchObject({ sim_mode: "link", connected: false });
  });
});

describe("POST /api/tracker/sample", () => {
  let server: TestServer;
  const SAMPLE = {
    t: Date.parse("2026-10-24T12:00:00Z"), lat: 41.7246, lon: -71.4282, alt_ft: 55, on_ground: true, gs_kts: 0, hdg_deg: 50,
    title: "Test Plane", livery: LIVERY, atc_id: "N1TP",
  };
  const post = () =>
    fetch(`${server.base}/api/tracker/sample`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(SAMPLE) });

  beforeAll(async () => {
    server = await startTestServer();
  });
  afterAll(async () => {
    await server.close();
  });
  beforeEach(() => {
    tracker.setConnected(false);
  });
  afterEach(() => {
    tracker.setSimMode("off");
  });

  // @spec LIVE-API-004, LIVE-LINK-003
  it.each<SimMode>(["off", "link"])(
    "refuses with 403 and changes nothing while the sim mode is %s, even with TRACKER_FAKE=1",
    async (mode) => {
      tracker.setSimMode(mode);
      const saved = process.env.TRACKER_FAKE;
      process.env.TRACKER_FAKE = "1";
      try {
        const before = tracker.status();
        const res = await post();
        expect(res.status).toBe(403);
        expect(await res.json()).toEqual({ error: "the fake feed is off: start the server with --sim=fake to accept synthetic samples" });
        expect(tracker.status()).toEqual(before);
        expect(tracker.status().connected).toBe(false);
      } finally {
        if (saved === undefined) delete process.env.TRACKER_FAKE;
        else process.env.TRACKER_FAKE = saved;
      }
    },
  );

  // @spec LIVE-API-004, LIVE-LINK-003
  it("feeds the sample while the sim mode is fake, with TRACKER_FAKE unset, marking the link connected as the fake feed", async () => {
    expect(process.env.TRACKER_FAKE).toBeUndefined();
    tracker.setSimMode("fake");
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ sim_mode: "fake", connected: true, sim_name: "fake feed", sim: { title: "Test Plane", livery: LIVERY } });
  });
});
