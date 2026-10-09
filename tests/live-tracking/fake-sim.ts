/**
 * A stand-in for a node-simconnect connection, so the sim link can be driven without a sim.
 * Test files mock `open` from "node-simconnect" and hand it one of these.
 */
import { EventEmitter } from "node:events";
import { vi } from "vitest";

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
  private nextSend = 1;
  addToDataDefinition = vi.fn((def: number, name: string) => {
    const id = this.nextSend++;
    this.defOf.set(name, def);
    this.sendIdOf.set(name, id);
    return id;
  });
  requestDataOnSimObject = vi.fn();
  subscribeToSystemEvent = vi.fn();
  close = vi.fn();

  /** The request id the link asked for the definition holding `datum`. */
  private requestFor(datum: string): number {
    const def = this.defOf.get(datum);
    const call = this.requestDataOnSimObject.mock.calls.find((c) => c[1] === def);
    if (!call) throw new Error(`the link never requested ${datum}`);
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

  /** The sim's answer to the livery request. */
  livery(name: string): void {
    this.emit("simObjectData", { requestID: this.requestFor("LIVERY NAME"), data: reader([name]) });
  }

  /** The sim rejecting the livery variable, as MSFS 2020 does. */
  rejectLivery(): void {
    this.emit("exception", { sendId: this.sendIdOf.get("LIVERY NAME"), exception: 7, exceptionName: "NAME_UNRECOGNIZED", index: 1 });
  }
}

/** Let the link's `open(...).then(...)` run. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}
