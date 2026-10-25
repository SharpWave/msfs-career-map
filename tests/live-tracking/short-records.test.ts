/**
 * Records the sim link cannot read (LIVE-LINK-018): a record shorter than its data definition,
 * which node-simconnect's reader throws on, is dropped. The connection and the server carry on; the
 * first such record of each definition on a connection is written out in full, later ones only
 * counted, and the count written when the connection ends or the link stops.
 */
import { RawBuffer, open } from "node-simconnect";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { SimSample } from "../../src/server/simconnect.ts";
import { Tracker } from "../../src/server/tracker.ts";
import { FakeSimHandle, answerOpen, linkTracker, settle } from "./fake-sim.ts";
import { resetLogbook } from "./state.ts";

vi.mock("node-simconnect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node-simconnect")>()),
  open: vi.fn(),
}));

const LIVERY = "N1TP";
const SHORT = "Illegal offset: 0 <= 36 (+8) <= 40";

type Kind = "position" | "livery" | "frame";
/** The word the link writes for each definition. */
const WORD: Record<Kind, string> = { position: "position", livery: "livery", frame: "per-frame" };

/** The line written for the first unreadable record of a definition on a connection. */
const firstLine = (kind: Kind, hex = "0a0b0c0d") => `[sim] dropped a ${WORD[kind]} record the link cannot read (${SHORT}): ${hex}`;
/** The line written for the count when the connection ends or the link stops. */
const countLine = (n: number, kind: Kind) =>
  `[sim] dropped ${n} ${WORD[kind]} record${n === 1 ? "" : "s"} the link could not read on that connection`;

/** Let real time pass, for the reconnect the link schedules (only Date is faked here). */
const realWait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** The request id the link asked for the definition holding `datum`, read from the fake handle's calls. */
function requestOf(hd: FakeSimHandle, datum: string): number {
  const def = hd.addToDataDefinition.mock.calls.find((c) => c[1] === datum)?.[0];
  const call = hd.requestDataOnSimObject.mock.calls.find((c) => c[1] === def);
  if (!call) throw new Error(`the link never requested ${datum}`);
  return call[0] as number;
}

/** A record no read* call can read, with whatever else `extra` gives it (or takes away). */
function unreadable(extra: Record<string, unknown>) {
  const short = () => {
    throw new RangeError(SHORT);
  };
  return { readFloat64: short, readInt32: short, readString128: short, readString32: short, ...extra };
}

describe("records the sim link cannot read", () => {
  let errors: MockInstance<typeof console.error>;
  let tr: Tracker;
  let fed: MockInstance<Tracker["feed"]>;
  let link: { stop(): void; connected(): boolean } | null;

  /** The tracker linked to fake sim connections, one per attempt, the first one open. */
  async function linked(o: { retryMs?: number } = {}, ...handles: FakeSimHandle[]) {
    answerOpen(...handles);
    link = linkTracker(tr, o);
    await settle();
    expect(tr.status().connected).toBe(true);
    return link;
  }

  /** The lines written with console.error, each call's arguments joined as it would print them. */
  const written = () => errors.mock.calls.map((args) => args.map(String).join(" "));

  beforeEach(() => {
    vi.mocked(open).mockReset();
    // Any connection attempt beyond the answered ones waits forever.
    vi.mocked(open).mockImplementation(() => new Promise(() => {}) as never);
    resetLogbook();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-24T12:00:00Z"));
    errors = vi.spyOn(console, "error").mockImplementation(() => {});
    tr = new Tracker();
    fed = vi.spyOn(tr, "feed");
    link = null;
  });
  afterEach(() => {
    link?.stop();
    errors.mockRestore();
    vi.useRealTimers();
  });

  // @spec LIVE-LINK-018
  it.each<[Kind, (hd: FakeSimHandle) => void]>([
    ["position", (hd) => hd.livery(LIVERY)],
    // A position waits for the livery: an unreadable livery record must not release it.
    ["livery", (hd) => hd.position({ lat: 41.70 })],
    ["frame", (hd) => hd.livery(LIVERY)],
  ])(
    "drops unreadable %s records, writing only the first in full, passing nothing on and keeping the connection",
    async (kind, before) => {
      const hd = new FakeSimHandle();
      const l = await linked({}, hd);
      before(hd);
      expect(fed).not.toHaveBeenCalled();

      for (let i = 0; i < 3; i++) expect(() => hd.shortRecord(kind)).not.toThrow();

      expect(errors.mock.calls).toEqual([[firstLine(kind)]]);
      expect(fed).not.toHaveBeenCalled();
      expect(tr.status().position).toBeNull();
      expect(l.connected()).toBe(true);
      expect(tr.status().connected).toBe(true);
      expect(hd.close).not.toHaveBeenCalled();
    },
  );

  // @spec LIVE-LINK-018
  it("handles a readable position as usual after unreadable ones: it arrives as a sample", async () => {
    const hd = new FakeSimHandle();
    await linked({}, hd);
    hd.livery(LIVERY);
    hd.shortRecord("position");
    hd.shortRecord("position");

    hd.position({ lat: 41.70 });
    expect(fed).toHaveBeenCalledTimes(1);
    expect(fed.mock.calls[0][0]).toMatchObject({ lat: 41.70, livery: LIVERY });
    expect(tr.status().position).toMatchObject({ lat: 41.70 });
  });

  // @spec LIVE-LINK-018
  it("handles a readable livery as usual after unreadable ones: it releases the samples held for it", async () => {
    const hd = new FakeSimHandle();
    await linked({}, hd);
    hd.position({ lat: 41.70 });
    hd.shortRecord("livery");
    hd.shortRecord("livery");
    expect(fed).not.toHaveBeenCalled();

    hd.livery("Red Tail");
    expect(fed.mock.calls.map(([s]) => [s.lat, s.livery])).toEqual([[41.70, "Red Tail"]]);
  });

  // @spec LIVE-LINK-018
  it("leaves the touchdown watcher as it was: a touchdown after unreadable per-frame records is measured from the last readable airborne frame", async () => {
    const hd = new FakeSimHandle();
    await linked({}, hd);
    hd.livery(LIVERY);
    hd.frame({ on_ground: false, vs_fpm: -400, g: 1, ias_kts: 70 });
    hd.shortRecord("frame");
    hd.shortRecord("frame");
    hd.shortRecord("frame");
    // No touchdown came of them.
    hd.position({ on_ground: false, alt_ft: 300 });
    expect((fed.mock.calls.at(-1)![0] as SimSample).touchdown).toBeUndefined();

    hd.frame({ on_ground: true, vs_fpm: 0, g: 1.6, ias_kts: 65 });
    vi.setSystemTime(Date.now() + 1100);
    hd.frame({ on_ground: true, vs_fpm: 0, g: 1, ias_kts: 60 });
    hd.position({ on_ground: true });
    expect((fed.mock.calls.at(-1)![0] as SimSample).touchdown).toMatchObject({ fpm: 400, g: 1.6, ias_kts: 70 });
  });

  // @spec LIVE-LINK-018
  it("writes the whole record's bytes in hex, not only the part read, or that they are unavailable when the record cannot give them", async () => {
    const hd = new FakeSimHandle();
    await linked({}, hd);
    // Its getBuffer() gives "dead", the part read; the record is all four bytes.
    hd.shortRecord("frame", Buffer.from("deadbeef", "hex"));
    // No buffer, only the part read.
    hd.emit("simObjectData", { requestID: requestOf(hd, "PLANE LATITUDE"), data: unreadable({ getBuffer: () => Buffer.from("0a", "hex") }) });
    // A buffer that cannot be read.
    const throwing = unreadable({});
    Object.defineProperty(throwing, "buffer", {
      get: () => {
        throw new RangeError("no buffer");
      },
    });
    hd.emit("simObjectData", { requestID: requestOf(hd, "LIVERY NAME"), data: throwing });

    expect(errors.mock.calls).toEqual([
      [firstLine("frame", "deadbeef")],
      [firstLine("position", "(record bytes unavailable)")],
      [firstLine("livery", "(record bytes unavailable)")],
    ]);
    expect(link!.connected()).toBe(true);
  });

  // @spec LIVE-LINK-018
  it("writes the whole of a real node-simconnect record cut short, past the point its reads stopped", async () => {
    const hd = new FakeSimHandle();
    await linked({}, hd);
    hd.livery(LIVERY);
    // A position record of 12 bytes: the latitude reads, the longitude runs past the end.
    const bytes = Buffer.alloc(12);
    bytes.writeDoubleLE(41.7, 0);
    bytes.writeUInt32LE(0xcafef00d, 8);
    hd.emit("simObjectData", { requestID: requestOf(hd, "PLANE LATITUDE"), data: new RawBuffer(bytes) });

    expect(errors.mock.calls).toHaveLength(1);
    const [line] = errors.mock.calls[0];
    expect(line).toMatch(/^\[sim\] dropped a position record the link cannot read \(.+\): [0-9a-f]+$/);
    expect(String(line).endsWith(`): ${bytes.toString("hex")}`)).toBe(true);
    expect(fed).not.toHaveBeenCalled();
    expect(link!.connected()).toBe(true);
  });

  // @spec LIVE-LINK-018
  it("writes how many records of each definition it dropped when the connection ends, record singular for one, and nothing for a definition that dropped none", async () => {
    const hd = new FakeSimHandle();
    await linked({}, hd);
    hd.livery(LIVERY);
    for (let i = 0; i < 3; i++) hd.shortRecord("position");
    hd.shortRecord("livery");
    hd.position({ lat: 41.70 });
    expect(written()).toEqual([firstLine("position"), firstLine("livery")]);

    hd.lose();
    expect(tr.status().connected).toBe(false);
    const counts = written().slice(2);
    expect(counts.sort()).toEqual([countLine(3, "position"), countLine(1, "livery")].sort());
    expect(counts).toContain("[sim] dropped 3 position records the link could not read on that connection");
    expect(counts).toContain("[sim] dropped 1 livery record the link could not read on that connection");
    expect(written().filter((l) => l.includes("per-frame"))).toEqual([]);
  });

  // @spec LIVE-LINK-018
  it("starts its counts again on a new connection, writing the first unreadable record there in full again, and ignores what the ended connection still sends", async () => {
    const first = new FakeSimHandle();
    const second = new FakeSimHandle();
    await linked({ retryMs: 10 }, first, second);
    first.livery(LIVERY);
    first.shortRecord("position");
    first.shortRecord("position");
    first.lose();
    expect(written()).toEqual([firstLine("position"), countLine(2, "position")]);

    for (let i = 0; i < 200 && !tr.status().connected; i++) await realWait(10);
    expect(tr.status().connected).toBe(true);

    // The ended connection's late records are neither written nor counted.
    first.shortRecord("position");
    first.shortRecord("frame");
    expect(written()).toHaveLength(2);

    second.livery(LIVERY);
    second.shortRecord("position");
    second.shortRecord("position");
    second.shortRecord("position");
    expect(written()).toEqual([firstLine("position"), countLine(2, "position"), firstLine("position")]);

    second.lose();
    expect(written()).toEqual([firstLine("position"), countLine(2, "position"), firstLine("position"), countLine(3, "position")]);
  });

  // @spec LIVE-LINK-018
  it("writes the counts when stop() stops an open connection, and neither writes nor counts records sent after it", async () => {
    const hd = new FakeSimHandle();
    const l = await linked({}, hd);
    hd.livery(LIVERY);
    hd.shortRecord("position");
    hd.shortRecord("position");
    hd.shortRecord("frame");
    expect(written()).toEqual([firstLine("position"), firstLine("frame")]);

    l.stop();
    expect(hd.close).toHaveBeenCalled();
    const counts = written().slice(2);
    expect(counts.sort()).toEqual([countLine(2, "position"), countLine(1, "frame")].sort());

    // What the stopped connection still sends, its close included.
    hd.shortRecord("position");
    hd.shortRecord("livery");
    hd.shortRecord("frame");
    hd.lose();
    await settle();
    expect(written()).toHaveLength(4);
    expect(fed).not.toHaveBeenCalled();
  });

  // @spec LIVE-LINK-018
  it("writes no counts when stop() finds no connection open", async () => {
    const hd = new FakeSimHandle();
    const l = await linked({}, hd);
    hd.shortRecord("position");
    hd.lose();
    const before = written();
    expect(before).toEqual([firstLine("position"), countLine(1, "position")]);

    l.stop();
    expect(written()).toEqual(before);
  });
});
