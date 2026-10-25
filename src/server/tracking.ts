import type { SimMode, Tracker } from "./tracker.ts";
import { startSimLink } from "./simconnect.ts";
import { isThisPc } from "./this-pc.ts";

/**
 * Starting tracking in the server's sim mode, taken from its inputs and never from the environment:
 * the sim link wired to the tracker on `link`, nothing started on `fake` (samples come from
 * `POST /api/tracker/sample`) or `off`. Starting it opens no database: the tracker is handed in.
 */

export interface Tracking {
  /** Stop the link: nothing it still sends reaches the tracker, no disconnect included. */
  stop(): void;
  connected(): boolean;
}

export interface TrackingOptions {
  sim: SimMode;
  simHost: string | null;
  simPort: number | null;
  retryMs?: number;
  /** The PC-wide sim-link claim's pipe name; accepted and not yet used. */
  claimPipe?: string;
}

/** Tracking that starts nothing: the fake feed and off. */
const nothingStarted = (): Tracking => ({ stop: () => {}, connected: () => false });

/**
 * Tell the tracker the sim mode, and the host of a sim on another PC (null for one on this PC, whose
 * host still reaches the link), then start the link when the mode is `link`.
 */
// @spec LIVE-LINK-012, LIVE-LINK-013, LIVE-API-013
export function startTracking(tracker: Tracker, o: TrackingOptions): Tracking {
  const host = o.sim === "link" && o.simHost && !isThisPc(o.simHost) ? o.simHost : null;
  tracker.setSimMode(o.sim, host);

  if (o.sim === "fake") {
    console.log("[sim] fake feed: POST /api/tracker/sample feeds the tracker (npm run sim-fake)");
    return nothingStarted();
  }
  if (o.sim === "off") {
    console.log("[sim] tracking off: start with --sim=link to track flights from MSFS");
    return nothingStarted();
  }

  return startSimLink(
    {
      onSample: (s) => tracker.feed(s),
      onConnect: (name) => {
        console.log(`[sim] connected to ${name}`);
        tracker.setConnected(true, name);
      },
      // @spec LIVE-LEG-008, LIVE-CASUAL-014
      onDisconnect: (reason, quit) => {
        console.log(`[sim] disconnected: ${reason}`);
        tracker.setConnected(false, null, { quit });
      },
      onPause: (p) => tracker.setPaused(p),
      onSimRunning: (r) => tracker.setSimRunning(r),
      onFlightLoaded: (f) => tracker.flightLoaded(f),
      onLiveryUnsupported: () => tracker.setLiverySupported(false),
      log: (m) => console.log(`[sim] ${m}`),
    },
    { host: o.simHost ?? undefined, port: o.simPort ?? undefined, retryMs: o.retryMs },
  );
}
