/**
 * The tracker as the desktop shell follows it (src/desktop/tracker-feed.ts; m2 contract §9.2): a
 * read of `GET /api/tracker`, then the event stream `/api/tracker/events` (DESK-SHELL-SRV-016), and
 * nothing else (DESK-SHELL-SRV-017); every chunk counting as activity, keep-alive comments included
 * (DESK-SHELL-SRV-027); a stream that ends subscribed again after 2 s, doubling after each failed
 * attempt up to 30 s while the server runs, the last status kept meanwhile (DESK-SHELL-SRV-042);
 * at once on resume (DESK-SHELL-SRV-039); every wait on the monotonic clock, Quit's 2 s read among
 * them (DESK-SHELL-SRV-037).
 */
import { describe, expect, it } from "vitest";
import { TrackerFeed, toTrayTracker, type TrayTracker } from "../../../src/desktop/tracker-feed.ts";
import type { HttpAnswer } from "../../../src/desktop/ports.ts";
import { FakeClock, flush } from "../support/clock.ts";
import { FakeHttp, never, sseEvent, trackerAnswer, trackerStatus } from "../support/fakes.ts";

const PORT = 3280;
const TRACKER = "/api/tracker";
const EVENTS = "/api/tracker/events";

function setup() {
  const clock = new FakeClock();
  const http = new FakeHttp();
  const statuses: TrayTracker[] = [];
  const order: string[] = [];
  const lines: string[] = [];
  /** onSubscribed's pending legs, one entry per call (m5a contract §5). */
  const subscribed: unknown[][] = [];
  /** onEvent's calls, as [name, data]. */
  const events: [string, unknown][] = [];
  const state = { running: true, activity: 0 };
  const feed = new TrackerFeed({
    port: PORT,
    clock,
    http,
    serverRunning: () => state.running,
    onStatus: (s: TrayTracker) => {
      statuses.push(s);
      order.push("status");
    },
    onActivity: () => {
      state.activity++;
      order.push("activity");
    },
    onSubscribed: (s: { pending: unknown[] }) => subscribed.push(s.pending),
    onEvent: (name: string, data: unknown) => events.push([name, data]),
    log: (line: string) => lines.push(line),
  });
  const reads = () => http.calls.filter((c) => c.path === TRACKER).length;
  return { clock, http, feed, statuses, order, lines, state, reads, subscribed, events };
}

/** A reply the test releases later. */
function held(): { reply: () => Promise<HttpAnswer | null>; release(a: HttpAnswer | null): void } {
  let release: (a: HttpAnswer | null) => void = () => {};
  const p = new Promise<HttpAnswer | null>((resolve) => {
    release = resolve;
  });
  return { reply: () => p, release: (a) => release(a) };
}

describe("subscribing", () => {
  // @spec DESK-SHELL-SRV-016, DESK-SHELL-SRV-017
  it("reads GET /api/tracker with a 10 s bound, passes its status on, then opens the event stream", async () => {
    const t = setup();
    t.http.on(PORT, TRACKER, trackerAnswer({ connected: true, sim_name: "Microsoft Flight Simulator 2024", phase: "ground" }));
    t.feed.subscribe();
    await flush();
    expect(t.http.calls).toEqual([{ port: PORT, path: TRACKER, timeoutMs: 10_000 }]);
    expect(t.statuses).toHaveLength(1);
    expect(t.statuses[0]).toMatchObject({ connected: true, sim_name: "Microsoft Flight Simulator 2024", phase: "ground" });
    expect(t.http.streams.map((s) => [s.port, s.path])).toEqual([[PORT, EVENTS]]);
    expect(t.feed.last()).toMatchObject({ connected: true, phase: "ground" });
  });

  // @spec DESK-SHELL-SRV-016, DESK-SHELL-SRV-037
  it("opens no stream until the read has answered, and counts a read with no answer in 10 s as a failed attempt", async () => {
    const t = setup();
    t.http.on(PORT, TRACKER, () => never());
    t.feed.subscribe();
    await flush();
    expect(t.http.streams).toHaveLength(0);
    await t.clock.advance(9_999);
    expect(t.http.streams).toHaveLength(0);
    expect(t.reads()).toBe(1);
    await t.clock.advance(1);
    expect(t.http.streams).toHaveLength(0);
    // The next attempt 2 s after that failure.
    await t.clock.advance(1_999);
    expect(t.reads()).toBe(1);
    await t.clock.advance(1);
    expect(t.reads()).toBe(2);
  });

  // @spec DESK-SHELL-SRV-016, DESK-SHELL-SRV-042
  it("counts a read answered with anything but a 200 as a failed attempt: no status, no stream, the next read 2 s later", async () => {
    const t = setup();
    t.http.on(PORT, TRACKER, { status: 503, body: JSON.stringify(trackerStatus({ connected: true })) });
    t.feed.subscribe();
    await flush();
    expect(t.reads()).toBe(1);
    expect(t.statuses).toHaveLength(0);
    expect(t.http.streams).toHaveLength(0);
    await t.clock.advance(1_999);
    expect(t.reads()).toBe(1);
    await t.clock.advance(1);
    expect(t.reads()).toBe(2);
    expect(t.http.streams).toHaveLength(0);
  });

  // @spec DESK-SHELL-SRV-016
  it("closes a stream already open when it subscribes again", async () => {
    const t = setup();
    t.http.on(PORT, TRACKER, trackerAnswer());
    t.feed.subscribe();
    await flush();
    t.http.streams[0].chunk(": ping\n\n");
    t.feed.subscribe();
    await flush();
    expect(t.http.streams).toHaveLength(2);
    expect(t.http.streams[0].closed).toBe(true);
    expect(t.http.openStreams()).toEqual([t.http.streams[1]]);
  });
});

describe("what the stream gives", () => {
  // @spec DESK-SHELL-SRV-017, DESK-SHELL-SRV-027
  it("counts every chunk as activity first, a keep-alive comment included, and passes on only status events", async () => {
    const t = setup();
    t.http.on(PORT, TRACKER, trackerAnswer());
    t.feed.subscribe();
    await flush();
    const stream = t.http.streams[0];
    t.order.length = 0;

    stream.chunk(": ping\n\n");
    await flush();
    expect(t.state.activity).toBe(1);
    expect(t.order).toEqual(["activity"]);

    stream.chunk(sseEvent("status", trackerStatus({ connected: true, sim_name: "MSFS 2024", phase: "airborne", leg: { origin: "KBOS" } })));
    await flush();
    expect(t.order).toEqual(["activity", "activity", "status"]);
    expect(t.statuses.at(-1)).toMatchObject({ connected: true, sim_name: "MSFS 2024", phase: "airborne", leg: { origin: "KBOS" } });

    const before = t.statuses.length;
    stream.chunk(sseEvent("track", { points: [] }) + sseEvent("hop", { id: 7 }) + sseEvent("pending", { id: "a" }));
    stream.chunk("event: status\ndata: 5\n\n");
    await flush();
    expect(t.statuses).toHaveLength(before);
    expect(t.state.activity).toBe(4);

    // An event split over two chunks: both chunks are activity, the status passes once complete.
    stream.chunk("event: status\ndata: ");
    await flush();
    expect(t.statuses).toHaveLength(before);
    stream.chunk(`${JSON.stringify(trackerStatus({ phase: "landed" }))}\n\n`);
    await flush();
    expect(t.statuses).toHaveLength(before + 1);
    expect(t.feed.last()).toMatchObject({ phase: "landed" });
    expect(t.state.activity).toBe(6);
  });

  // @spec DESK-SHELL-SRV-017
  it("reads nothing but /api/tracker and /api/tracker/events", async () => {
    const t = setup();
    t.http.on(PORT, TRACKER, trackerAnswer());
    t.feed.subscribe();
    await flush();
    t.http.streams[0].chunk(sseEvent("status", trackerStatus()));
    t.http.streams[0].end();
    await t.clock.advance(60_000);
    await t.feed.readNow(2_000);
    expect(new Set(t.http.calls.map((c) => `${c.port} ${c.path}`))).toEqual(new Set([`${PORT} ${TRACKER}`]));
    expect(new Set(t.http.streams.map((s) => `${s.port} ${s.path}`))).toEqual(new Set([`${PORT} ${EVENTS}`]));
  });
});

describe("subscribing again", () => {
  // @spec DESK-SHELL-SRV-042
  it("waits 2 s, 4, 8, 16, then 30 and 30 between attempts that fail while the server runs", async () => {
    const t = setup(); // no reply to /api/tracker: every read gets nothing
    t.feed.subscribe();
    await flush();
    expect(t.reads()).toBe(1);
    let reads = 1;
    for (const wait of [2_000, 4_000, 8_000, 16_000, 30_000, 30_000]) {
      await t.clock.advance(wait - 1);
      expect(t.reads()).toBe(reads);
      await t.clock.advance(1);
      expect(t.reads()).toBe(++reads);
    }
  });

  // @spec DESK-SHELL-SRV-042
  it("counts a stream that ends before its first chunk as failed, and a chunk as success that resets the wait to 2 s", async () => {
    const t = setup();
    t.http.on(PORT, TRACKER, trackerAnswer());
    t.feed.subscribe();
    await flush();
    t.http.streams[0].end(); // fails: wait 2 s
    await t.clock.advance(1_999);
    expect(t.http.streams).toHaveLength(1);
    await t.clock.advance(1);
    expect(t.http.streams).toHaveLength(2);
    t.http.streams[1].end(); // fails again: wait 4 s
    await t.clock.advance(3_999);
    expect(t.http.streams).toHaveLength(2);
    await t.clock.advance(1);
    expect(t.http.streams).toHaveLength(3);
    t.http.streams[2].chunk(": ping\n\n"); // succeeds
    await t.clock.advance(60_000);
    expect(t.http.streams).toHaveLength(3);
    t.http.streams[2].end(); // ended after a success: 2 s
    await t.clock.advance(1_999);
    expect(t.http.streams).toHaveLength(3);
    await t.clock.advance(1);
    expect(t.http.streams).toHaveLength(4);
    expect(t.reads()).toBe(4);
  });

  // @spec DESK-SHELL-SRV-042
  it("keeps the last status received while the stream is down and attempts fail", async () => {
    const t = setup();
    t.http.on(PORT, TRACKER, trackerAnswer({ connected: true, sim_name: "MSFS 2024" }));
    expect(t.feed.last()).toBeNull();
    t.feed.subscribe();
    await flush();
    t.http.streams[0].chunk(sseEvent("status", trackerStatus({ connected: true, sim_name: "MSFS 2024", phase: "airborne", leg: { origin: "KPVD" } })));
    await flush();
    t.http.on(PORT, TRACKER, null);
    t.http.streams[0].end();
    await t.clock.advance(20_000);
    expect(t.reads()).toBeGreaterThan(1);
    expect(t.feed.last()).toMatchObject({ connected: true, phase: "airborne", leg: { origin: "KPVD" } });
  });

  // @spec DESK-SHELL-SRV-042
  it("attempts nothing while no server process runs, holding no wait, until subscribe()", async () => {
    const t = setup();
    t.http.on(PORT, TRACKER, trackerAnswer());
    t.feed.subscribe();
    await flush();
    t.http.streams[0].chunk(": ping\n\n");
    t.state.running = false;
    t.http.streams[0].end();
    await t.clock.advance(120_000);
    expect(t.reads()).toBe(1);
    expect(t.http.streams).toHaveLength(1);
    expect(t.clock.pending()).toBe(0);
    t.state.running = true;
    t.feed.subscribe();
    await flush();
    expect(t.reads()).toBe(2);
    expect(t.http.streams).toHaveLength(2);
  });

  // @spec DESK-SHELL-SRV-042
  it("does not retry a failed attempt while no server process runs", async () => {
    const t = setup();
    t.http.on(PORT, TRACKER, () => never());
    t.feed.subscribe();
    await flush();
    t.state.running = false;
    await t.clock.advance(10_000);
    await t.clock.advance(120_000);
    expect(t.reads()).toBe(1);
    expect(t.clock.pending()).toBe(0);
  });

  // @spec DESK-SHELL-SRV-037, DESK-SHELL-SRV-042
  it("measures the waits on the monotonic clock: a system clock change moves none", async () => {
    const t = setup();
    t.feed.subscribe();
    await flush();
    t.clock.setWall("2026-11-30T00:00:00.000Z");
    await t.clock.advance(1_999);
    expect(t.reads()).toBe(1);
    t.clock.setWall("2026-01-01T00:00:00.000Z");
    await t.clock.advance(1);
    expect(t.reads()).toBe(2);
  });

  // @spec DESK-SHELL-SRV-016
  it("restarts the waits from 2 s at subscribe()", async () => {
    const t = setup();
    t.feed.subscribe();
    await flush();
    await t.clock.advance(2_000);
    await t.clock.advance(4_000);
    expect(t.reads()).toBe(3); // now waiting 8 s
    t.feed.subscribe();
    await flush();
    expect(t.reads()).toBe(4);
    await t.clock.advance(1_999);
    expect(t.reads()).toBe(4);
    await t.clock.advance(1);
    expect(t.reads()).toBe(5);
  });
});

describe("resume", () => {
  // @spec DESK-SHELL-SRV-039
  it("subscribes at once when no stream is open and the server runs, not waiting out the wait", async () => {
    const t = setup();
    t.feed.subscribe();
    await flush();
    await t.clock.advance(2_000);
    await t.clock.advance(4_000);
    await t.clock.advance(8_000);
    expect(t.reads()).toBe(4); // now waiting 16 s
    t.http.on(PORT, TRACKER, trackerAnswer());
    t.feed.resume();
    await flush();
    expect(t.reads()).toBe(5);
    expect(t.http.openStreams()).toHaveLength(1);
    // The wait it cut short is cancelled: nothing more when it would have run out.
    t.http.openStreams()[0].chunk(": ping\n\n");
    await t.clock.advance(16_000);
    expect(t.reads()).toBe(5);
    expect(t.http.streams).toHaveLength(1);
    expect(t.http.streams[0].closed).toBe(false);
  });

  // @spec DESK-SHELL-SRV-039
  it("does nothing while a stream is open", async () => {
    const t = setup();
    t.http.on(PORT, TRACKER, trackerAnswer());
    t.feed.subscribe();
    await flush();
    t.http.streams[0].chunk(": ping\n\n");
    t.feed.resume();
    await flush();
    expect(t.reads()).toBe(1);
    expect(t.http.streams).toHaveLength(1);
    expect(t.http.streams[0].closed).toBe(false);
  });

  // @spec DESK-SHELL-SRV-039
  it("does nothing while no server process runs", async () => {
    const t = setup();
    t.http.on(PORT, TRACKER, trackerAnswer());
    t.feed.subscribe();
    await flush();
    t.state.running = false;
    t.http.streams[0].end();
    await flush();
    t.feed.resume();
    await flush();
    expect(t.reads()).toBe(1);
  });
});

describe("stop", () => {
  // @spec DESK-SHELL-SRV-042
  it("closes the open stream and attempts nothing more, holding no wait", async () => {
    const t = setup();
    t.http.on(PORT, TRACKER, trackerAnswer());
    t.feed.subscribe();
    await flush();
    t.http.streams[0].chunk(": ping\n\n");
    t.feed.stop();
    expect(t.http.streams[0].closed).toBe(true);
    expect(t.clock.pending()).toBe(0);
    await t.clock.advance(120_000);
    expect(t.reads()).toBe(1);
    expect(t.http.streams).toHaveLength(1);
  });

  // @spec DESK-SHELL-SRV-042
  it("cancels a pending attempt", async () => {
    const t = setup();
    t.feed.subscribe();
    await flush();
    t.feed.stop();
    expect(t.clock.pending()).toBe(0);
    await t.clock.advance(120_000);
    expect(t.reads()).toBe(1);
  });

  // @spec DESK-SHELL-SRV-042
  it("leaves no bound behind for a read still outstanding, and opens no stream when it answers later", async () => {
    const t = setup();
    const h = held();
    t.http.on(PORT, TRACKER, h.reply);
    t.feed.subscribe();
    await flush();
    t.feed.stop();
    expect(t.clock.pending()).toBe(0);
    h.release(trackerAnswer());
    await flush();
    await t.clock.advance(60_000);
    expect(t.http.streams).toHaveLength(0);
    expect(t.reads()).toBe(1);
  });
});

describe("readNow", () => {
  // @spec DESK-SHELL-SRV-037
  it("gives null exactly when its bound runs out on the clock, leaving no wait", async () => {
    const t = setup();
    t.http.on(PORT, TRACKER, () => never());
    let result: TrayTracker | null | undefined;
    void t.feed.readNow(2_000).then((r: TrayTracker | null) => {
      result = r;
    });
    await flush();
    expect(t.reads()).toBe(1);
    await t.clock.advance(1_999);
    expect(result).toBeUndefined();
    await t.clock.advance(1);
    expect(result).toBeNull();
    expect(t.clock.pending()).toBe(0);
  });

  // @spec DESK-SHELL-SRV-016
  it("gives the tracker's status when it answers in time", async () => {
    const t = setup();
    t.http.on(PORT, TRACKER, trackerAnswer({ phase: "airborne", leg: { origin: "KBOS" } }));
    const r = await t.feed.readNow(2_000);
    expect(r).toMatchObject({ phase: "airborne", leg: { origin: "KBOS" } });
    expect(t.clock.pending()).toBe(0);
  });

  // @spec DESK-SHELL-SRV-016
  it("gives null for an answer that is not a 200 with a status", async () => {
    const t = setup();
    t.http.on(PORT, TRACKER, { status: 503, body: JSON.stringify({ error: "starting" }) });
    expect(await t.feed.readNow(2_000)).toBeNull();
    t.http.on(PORT, TRACKER, { status: 200, body: "not json" });
    expect(await t.feed.readNow(2_000)).toBeNull();
    t.http.on(PORT, TRACKER, null);
    expect(await t.feed.readNow(2_000)).toBeNull();
  });
});

describe("toTrayTracker", () => {
  // @spec DESK-SHELL-SRV-017
  it("takes the fields the tray reads from a full tracker status", () => {
    const s = toTrayTracker(
      trackerStatus({
        connected: true,
        sim_name: "MSFS 2024",
        link_holder: { text: "Another copy holds the sim link" },
        phase: "airborne",
        leg: { origin: "KBOS", aircraft_id: 3 },
        pending: [{ id: "a1" }, { id: "b2" }],
        casual: { since: "2026-10-25T11:00:00.000Z" },
      }),
    );
    expect(s).not.toBeNull();
    expect(s!.connected).toBe(true);
    expect(s!.sim_name).toBe("MSFS 2024");
    expect(s!.link_holder?.text).toBe("Another copy holds the sim link");
    expect(s!.phase).toBe("airborne");
    expect(s!.leg?.origin).toBe("KBOS");
    expect(s!.pending.map((p: { id: string }) => p.id)).toEqual(["a1", "b2"]);
    expect(s!.casual).toMatchObject({ since: "2026-10-25T11:00:00.000Z" });
  });

  // @spec DESK-SHELL-SRV-017
  it("is null for anything but an object", () => {
    for (const v of [null, undefined, 5, "status", true]) expect(toTrayTracker(v)).toBeNull();
  });

  // @spec DESK-SHELL-SRV-017
  it("defaults each field alone when missing or of the wrong type", () => {
    expect(toTrayTracker({})).toEqual({
      connected: false,
      sim_name: null,
      link_holder: null,
      phase: "idle",
      leg: null,
      pending: [],
      casual: null,
    });
    const s = toTrayTracker({
      connected: "yes",
      sim_name: 5,
      link_holder: { text: 7 },
      phase: 3,
      leg: { origin: 9 },
      pending: [{ id: "keep" }, { id: 4 }, "x", null],
      casual: "on",
    });
    expect(s).not.toBeNull();
    expect(s!.connected).toBe(false);
    expect(s!.sim_name).toBeNull();
    expect(s!.link_holder).toBeNull();
    expect(s!.phase).toBe("idle");
    expect(s!.leg).not.toBeNull();
    expect(s!.leg!.origin).toBeNull();
    expect(s!.pending.map((p: { id: string }) => p.id)).toEqual(["keep"]);
    expect(s!.casual).toBeNull();
    expect(toTrayTracker({ leg: "KBOS", connected: 1 })).toMatchObject({ leg: null, connected: false });
  });
});

/** A pending leg as the status lists it (LIVE-API-014), with `o` over it. */
function pendingLeg(id: string, o: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    sim: { title: "Cessna 172 Skyhawk G1000", livery: "Asobo Blue", atc_id: "N172SP" },
    origin: "KBOS",
    dest: "KPVD",
    reason: "No aircraft in the fleet matches this sim aircraft",
    points: 540,
    ...o,
  };
}
const AS_NOTICE = { id: "a", sim: { title: "Cessna 172 Skyhawk G1000", livery: "Asobo Blue" }, reason: "No aircraft in the fleet matches this sim aircraft" };

describe("what the notifications follow (m5a)", () => {
  // @spec DESK-SHELL-NOTE-007, DESK-SHELL-NOTE-008
  it("hands each successful read's pending legs to onSubscribed, before the stream opens, at every subscription", async () => {
    const t = setup();
    t.http.on(PORT, TRACKER, trackerAnswer({ pending: [pendingLeg("a")] }));
    t.feed.subscribe();
    await flush();
    expect(t.subscribed).toEqual([[AS_NOTICE]]);
    expect(t.http.streams).toHaveLength(1);

    t.http.on(PORT, TRACKER, trackerAnswer({ pending: [pendingLeg("a"), pendingLeg("b", { sim: null, reason: "Disconnected in flight" })] }));
    t.http.streams[0].end();
    await t.clock.advance(2_000);
    expect(t.subscribed).toEqual([
      [AS_NOTICE],
      [AS_NOTICE, { id: "b", sim: null, reason: "Disconnected in flight" }],
    ]);
  });

  // @spec DESK-SHELL-NOTE-008
  it("calls onSubscribed for no read that failed: no answer, an answer other than 200, or none in 10 s", async () => {
    const t = setup();
    t.http.on(PORT, TRACKER, { status: 503, body: "" });
    t.feed.subscribe();
    await flush();
    t.http.on(PORT, TRACKER, () => never());
    await t.clock.advance(2_000);
    await t.clock.advance(10_000);
    expect(t.subscribed).toEqual([]);
  });

  // @spec DESK-SHELL-NOTE-001, DESK-SHELL-NOTE-007
  it("reads each listed leg's id, sim aircraft and reason, defaulting each, and passes over a leg with no id", async () => {
    const t = setup();
    t.http.on(
      PORT,
      TRACKER,
      trackerAnswer({
        pending: [
          pendingLeg("a"),
          pendingLeg("b", { sim: { title: 5, livery: null } }),
          pendingLeg("c", { reason: 7 }),
          { reason: "no id" },
          pendingLeg("d", { sim: "Cessna" }),
          "x",
        ],
      }),
    );
    t.feed.subscribe();
    await flush();
    expect(t.subscribed).toEqual([
      [
        AS_NOTICE,
        { id: "b", sim: { title: "", livery: "" }, reason: "No aircraft in the fleet matches this sim aircraft" },
        { id: "c", sim: { title: "Cessna 172 Skyhawk G1000", livery: "Asobo Blue" }, reason: "" },
        { id: "d", sim: null, reason: "No aircraft in the fleet matches this sim aircraft" },
      ],
    ]);
  });

  // @spec DESK-SHELL-NOTE-001, DESK-SHELL-NOTE-002
  it("passes `pending` and `hop` events on as they come, and nothing for other events", async () => {
    const t = setup();
    t.http.on(PORT, TRACKER, trackerAnswer());
    t.feed.subscribe();
    await flush();
    const stream = t.http.streams[0];
    stream.chunk(
      sseEvent("track", { points: [] }) +
        sseEvent("pending", pendingLeg("a")) +
        sseEvent("hop", { hop: { id: 12, origin: "KBOS", dest: "KPVD" }, message: "Logged KBOS → KPVD, 45 min, 180 fpm butter" }) +
        sseEvent("status", trackerStatus({ phase: "ground" })),
    );
    await flush();
    expect(t.events).toEqual([
      ["pending", AS_NOTICE],
      ["hop", { id: 12, message: "Logged KBOS → KPVD, 45 min, 180 fpm butter" }],
    ]);
  });

  // @spec DESK-SHELL-NOTE-002
  it("drops a malformed `pending` or `hop` event", async () => {
    const t = setup();
    t.http.on(PORT, TRACKER, trackerAnswer());
    t.feed.subscribe();
    await flush();
    const stream = t.http.streams[0];
    stream.chunk(
      sseEvent("pending", { reason: "no id" }) +
        sseEvent("pending", "a") +
        sseEvent("hop", { id: 7 }) +
        sseEvent("hop", { hop: { id: "12" }, message: "x" }) +
        sseEvent("hop", { hop: { id: 12 } }) +
        sseEvent("hop", { message: "no hop" }) +
        "event: hop\ndata: {not json\n\n",
    );
    await flush();
    expect(t.events).toEqual([]);
    // The stream goes on after them.
    stream.chunk(sseEvent("hop", { hop: { id: 13 }, message: "Logged KPVD → KBOS" }));
    await flush();
    expect(t.events).toEqual([["hop", { id: 13, message: "Logged KPVD → KBOS" }]]);
  });

  // @spec DESK-SHELL-NOTE-009
  it("passes on no event from a stream it has closed", async () => {
    const t = setup();
    t.http.on(PORT, TRACKER, trackerAnswer());
    t.feed.subscribe();
    await flush();
    const stream = t.http.streams[0];
    t.feed.stop();
    stream.chunk(sseEvent("hop", { hop: { id: 12 }, message: "Logged KBOS → KPVD" }));
    await flush();
    expect(t.events).toEqual([]);
  });
});
