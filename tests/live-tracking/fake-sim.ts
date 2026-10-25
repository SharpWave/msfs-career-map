/**
 * A stand-in for a node-simconnect connection, so the sim link can be driven without a sim.
 * Test files mock `open` from "node-simconnect" and hand it one of these:
 *
 *   vi.mock("node-simconnect", async (importOriginal) => ({
 *     ...(await importOriginal<typeof import("node-simconnect")>()),
 *     open: vi.fn(),
 *   }));
 */
import { EventEmitter } from "node:events";
import { open } from "node-simconnect";
import { vi } from "vitest";
import { startSimLink } from "../../src/server/simconnect.ts";
import type { Tracker } from "../../src/server/tracker.ts";

export interface FakePosition {
  lat: number;
  lon: number;
  alt_ft: number;
  on_ground: boolean;
  gs_kts: number;
  hdg_deg: number;
  vs_fpm: number;
  ias_kts: number;
  g: number;
  fuel_lb: number;
  weight_lb: number;
  title: string;
  atc_id: string;
}

const DEFAULT_POSITION: FakePosition = {
  lat: 41.7246, lon: -71.4282, alt_ft: 55, on_ground: true, gs_kts: 0, hdg_deg: 50, vs_fpm: 0, ias_kts: 0,
  g: 1, fuel_lb: 300, weight_lb: 2400, title: "Test Plane", atc_id: "N1TP",
};

/** A data block whose read* calls return `values` in order, as the link reads them. */
function reader(values: unknown[]) {
  let i = 0;
  const next = () => values[i++];
  return { readFloat64: next, readInt32: next, readString128: next, readString32: next };
}

export class FakeSimHandle extends EventEmitter {
  private defOf = new Map<string, number>();
  private sendIdOf = new Map<string, number>();
  /** Every datum each definition holds, in the order the link added them. */
  private datumsOf = new Map<number, string[]>();
  private nextSend = 1;
  addToDataDefinition = vi.fn((def: number, name: string) => {
    const id = this.nextSend++;
    this.defOf.set(name, def);
    this.sendIdOf.set(name, id);
    this.datumsOf.set(def, [...(this.datumsOf.get(def) ?? []), name]);
    return id;
  });
  requestDataOnSimObject = vi.fn();
  subscribeToSystemEvent = vi.fn();
  close = vi.fn();

  /** The request id the link asked for the definition holding `datum`. */
  private requestFor(datum: string): number {
    const def = this.defOf.get(datum);
    return this.requestForDef(def, datum);
  }

  private requestForDef(def: number | undefined, what: string): number {
    const call = this.requestDataOnSimObject.mock.calls.find((c) => c[1] === def);
    if (!call) throw new Error(`the link never requested ${what}`);
    return call[0] as number;
  }

  /** The client event id the link subscribed to the system event `name` under. */
  private eventFor(name: string): number {
    const call = this.subscribeToSystemEvent.mock.calls.find((c) => c[1] === name);
    if (!call) throw new Error(`the link never subscribed to the ${name} event`);
    return call[0] as number;
  }

  /** One once-a-second position record, in the order the link defines its fields. */
  position(p: Partial<FakePosition> = {}): void {
    const s = { ...DEFAULT_POSITION, ...p };
    const values = [
      s.lat, s.lon, s.alt_ft, s.on_ground ? 1 : 0, s.gs_kts, s.hdg_deg, s.vs_fpm, s.ias_kts, s.g, s.fuel_lb, s.weight_lb,
      0, 0, 0, s.title, s.atc_id,
    ];
    this.emit("simObjectData", { requestID: this.requestFor("PLANE LATITUDE"), data: reader(values) });
  }

  /**
   * One per-frame record for the touchdown watcher: on-ground flag, vertical speed (fpm, positive
   * up), G and indicated airspeed, in the order the link defines them.
   */
  frame(f: { on_ground: boolean; vs_fpm?: number; g?: number; ias_kts?: number }): void {
    const positionDef = this.defOf.get("PLANE LATITUDE");
    const frameDef = [...this.datumsOf].find(([def, names]) => def !== positionDef && names.includes("SIM ON GROUND"))?.[0];
    const values = [f.on_ground ? 1 : 0, f.vs_fpm ?? 0, f.g ?? 1, f.ias_kts ?? 0];
    this.emit("simObjectData", { requestID: this.requestForDef(frameDef, "the per-frame data"), data: reader(values) });
  }

  /** The sim's answer to the livery request. */
  livery(name: string): void {
    this.emit("simObjectData", { requestID: this.requestFor("LIVERY NAME"), data: reader([name]) });
  }

  /**
   * A record of that definition the link cannot read: every read* call throws
   * RangeError("Illegal offset: 0 <= 36 (+8) <= 40"), as node-simconnect's RawBuffer does on a short
   * record. Like a RawBuffer, the whole record is on `buffer`, while getBuffer() gives only the part
   * read so far: here the first half of `bytes`.
   */
  shortRecord(kind: "position" | "livery" | "frame", bytes: Buffer = Buffer.from("0a0b0c0d", "hex")): void {
    let requestID: number;
    if (kind === "position") requestID = this.requestFor("PLANE LATITUDE");
    else if (kind === "livery") requestID = this.requestFor("LIVERY NAME");
    else {
      const positionDef = this.defOf.get("PLANE LATITUDE");
      const frameDef = [...this.datumsOf].find(([def, names]) => def !== positionDef && names.includes("SIM ON GROUND"))?.[0];
      requestID = this.requestForDef(frameDef, "the per-frame data");
    }
    const short = () => {
      throw new RangeError("Illegal offset: 0 <= 36 (+8) <= 40");
    };
    this.emit("simObjectData", {
      requestID,
      data: {
        readFloat64: short,
        readInt32: short,
        readString128: short,
        readString32: short,
        buffer: bytes,
        getBuffer: () => Buffer.from(bytes.subarray(0, Math.floor(bytes.length / 2))),
      },
    });
  }

  /** The sim rejecting the livery variable, as MSFS 2020 does. */
  rejectLivery(): void {
    this.emit("exception", { sendId: this.sendIdOf.get("LIVERY NAME"), exception: 7, exceptionName: "NAME_UNRECOGNIZED", index: 1 });
  }

  /** The sim's Pause or Sim system event: `on` is paused, or running (false in menus and loading). */
  systemEvent(name: "Pause" | "Sim", on: boolean): void {
    this.emit("event", { clientEventId: this.eventFor(name), data: on ? 1 : 0 });
  }

  /** The sim's FlightLoaded system event. */
  flightLoaded(file = "C:\\flights\\test.FLT"): void {
    this.emit("eventFilename", { clientEventId: this.eventFor("FlightLoaded"), fileName: file });
  }

  /** SimConnect's quit event: MSFS closing normally. */
  quit(): void {
    this.emit("quit");
  }

  /**
   * The connection closing with no quit event (a sim crash, a lost connection). The real handle
   * also emits this once its `close()` has run.
   */
  lose(): void {
    this.emit("close");
  }

  /** The connection failing. */
  fail(message = "connection reset"): void {
    this.emit("error", new Error(message));
  }
}

/**
 * Flies through the link: each call sends once-a-second position records, the (faked) Date moving
 * 1 s after each, heading north while it has ground speed. Needs `vi.useFakeTimers({ toFake: ["Date"] })`
 * and the livery answered (`hd.livery(...)`) for the samples to reach the tracker.
 */
export function simPilot(hd: FakeSimHandle, start: Partial<FakePosition> = {}) {
  let pos: FakePosition = { ...DEFAULT_POSITION, ...start };
  const step = (over: Partial<FakePosition>) => {
    pos = { ...pos, ...over };
    hd.position(pos);
    vi.setSystemTime(Date.now() + 1000);
    if (pos.gs_kts >= 1) pos = { ...pos, lat: pos.lat + pos.gs_kts / 3600 / 60 };
  };
  return {
    /** n seconds on the ground at gs knots. */
    ground: (n: number, gs = 0) => { for (let i = 0; i < n; i++) step({ on_ground: true, gs_kts: gs, ias_kts: gs, alt_ft: 55, vs_fpm: 0 }); },
    /** n seconds airborne. */
    air: (n: number, gs = 100) => { for (let i = 0; i < n; i++) step({ on_ground: false, gs_kts: gs, ias_kts: gs, alt_ft: 1500, vs_fpm: 0 }); },
    /** The position the next record starts from. */
    get position(): FakePosition {
      return pos;
    },
  };
}

/** Let the link's `open(...).then(...)` run. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/**
 * Have the mocked `open` answer the link's next connection attempts with these handles, one per
 * attempt, in order. Needs the test file to mock node-simconnect's `open` (see the top of this file).
 */
export function answerOpen(...handles: FakeSimHandle[]): void {
  for (const hd of handles) {
    vi.mocked(open).mockResolvedValueOnce({ recvOpen: { applicationName: "Fake MSFS" }, handle: hd } as never);
  }
}

/** `setConnected` with the clean-quit flag the link reports a disconnect with. */
type SetConnected = (v: boolean, name?: string | null, opts?: { quit?: boolean }) => void;

/**
 * Start the sim link feeding `tr` the way the server wires it (src/server/index.ts, which tests may
 * not import): samples to `feed`, the connection and its end (with whether the sim quit cleanly) to
 * `setConnected`, and pause, sim running, flight loaded and an unsupported livery to their setters.
 * Answer `open` first (`answerOpen`), then `await settle()` for the connection to open.
 */
export function linkTracker(tr: Tracker, o: { retryMs?: number } = {}): { stop(): void; connected(): boolean } {
  const setConnected = tr.setConnected as SetConnected;
  return startSimLink(
    {
      onSample: (s) => tr.feed(s),
      onConnect: (name) => tr.setConnected(true, name),
      onDisconnect: (_reason: string, quit?: boolean) => setConnected.call(tr, false, null, { quit: quit === true }),
      onPause: (p) => tr.setPaused(p),
      onSimRunning: (r) => tr.setSimRunning(r),
      onFlightLoaded: (f) => tr.flightLoaded(f),
      onLiveryUnsupported: () => tr.setLiverySupported(false),
    },
    { retryMs: o.retryMs ?? 60_000 },
  );
}
