import type { InSim } from "./airport-data.ts";
import type { SimMode, Tracker, TrackerStatus } from "./tracker.ts";
import { currentInputs } from "./inputs.ts";
import { startSimLink, type SimLinkGate } from "./simconnect.ts";
import { SIM_LINK_PIPE, checkClaim, takeClaim, type ClaimHolder, type HeldClaim } from "./sim-link-claim.ts";
import { isThisPc } from "./this-pc.ts";

/**
 * Starting tracking in the server's sim mode, taken from its inputs and never from the environment:
 * the sim link wired to the tracker on `link`, nothing started on `fake` (samples come from
 * `POST /api/tracker/sample`) or `off`. Starting it opens no database: the tracker is handed in.
 * A link to the sim on this PC goes through the PC-wide sim-link claim (sim-link-claim.ts).
 */

export interface Tracking {
  /** Stop the link: nothing it still sends reaches the tracker, no disconnect included; the claim is released. */
  stop(): void;
  /** Stop the link as stop() does, to bring in a logbook; resume() starts it again. */
  pause(): void;
  /** Start the link again after a pause (an import that failed before its answer). */
  resume(): void;
  connected(): boolean;
}

export interface TrackingOptions {
  sim: SimMode;
  simHost: string | null;
  simPort: number | null;
  retryMs?: number;
  /** The PC-wide sim-link claim's pipe name; tests give a private one. */
  claimPipe?: string;
  /** Who this server is when it holds the claim: the bundled server "installed", a copy run from source "source". */
  holder?: "installed" | "source";
  /** The data folder this server answers a check of the claim with; the inputs' by default. */
  dataFolder?: string;
}

/**
 * The check the server hands airports' refresh: the pilot is in the sim while this server's sim link
 * is connected (the fake feed's "connected" never counts) or the tracker holds a leg in progress, a
 * restored one still waiting for the sim included. The listener hears only changes of that answer.
 */
// @spec APP-SRV-012
export function pilotInSim(tracker: Pick<Tracker, "status" | "on" | "off">): InSim {
  const inSim = (s: Pick<TrackerStatus, "sim_mode" | "connected" | "leg">) => (s.sim_mode === "link" && s.connected) || s.leg !== null;
  return {
    now: () => inSim(tracker.status()),
    onChange(listener) {
      let last = inSim(tracker.status());
      const heard = (s: TrackerStatus) => {
        const v = inSim(s);
        if (v === last) return;
        last = v;
        listener();
      };
      tracker.on("status", heard);
      return () => {
        tracker.off("status", heard);
      };
    },
  };
}

/** Tracking that starts nothing: the fake feed and off. */
const nothingStarted = (): Tracking => ({ stop: () => {}, pause: () => {}, resume: () => {}, connected: () => false });

/**
 * Tell the tracker the sim mode, and the host of a sim on another PC (null for one on this PC, whose
 * host still reaches the link), then start the link when the mode is `link`.
 */
// @spec LIVE-LINK-012, LIVE-LINK-013, LIVE-API-013, LIVE-LINK-015
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

  /** The link and, for a sim on this PC, its claim, started afresh. */
  const startLink = () => {
    // A sim on another PC: no claim to take or check, since one on this PC says nothing about it.
    const claim = host === null ? simLinkClaim(tracker, o) : null;
    const link = startSimLink(
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
      { host: o.simHost ?? undefined, port: o.simPort ?? undefined, retryMs: o.retryMs, gate: claim?.gate },
    );
    return {
      stop() {
        claim?.stop();
        link.stop();
      },
      connected: () => link.connected(),
    };
  };

  let running: ReturnType<typeof startLink> | null = startLink();
  let stopped = false;
  return {
    // @spec LIVE-LINK-011
    stop() {
      stopped = true;
      running?.stop();
      running = null;
    },
    // @spec LIVE-LINK-017
    pause() {
      running?.stop();
      running = null;
    },
    // @spec LIVE-LINK-017
    resume() {
      if (!stopped && !running) running = startLink();
    },
    connected: () => running?.connected() ?? false,
  };
}

/**
 * The PC-wide sim-link claim as a gate on the link: checked before each attempt, the holder put in
 * the tracker's status (and written once for each holder in a row) while another server holds it;
 * taken once SimConnect opens; released when the connection ends or the link stops.
 */
// @spec LIVE-LINK-001, LIVE-LINK-010, LIVE-LINK-014, LIVE-API-013
function simLinkClaim(tracker: Tracker, o: TrackingOptions): { gate: SimLinkGate; stop(): void } {
  const pipe = o.claimPipe ?? SIM_LINK_PIPE;
  const who = { holder: o.holder ?? "source", data_folder: o.dataFolder ?? currentInputs().dataFolder };
  let held: HeldClaim | null = null;
  let stopped = false;
  /** The holder last reported, as JSON; null while none is. */
  let reported: string | null = null;

  const report = (h: ClaimHolder | null) => {
    const key = h ? JSON.stringify(h) : null;
    if (key === reported) return;
    reported = key;
    tracker.setLinkHolder(h);
    if (h) console.log(`[sim] ${tracker.status().link_holder?.text}: waiting for it to let go of the sim`);
  };

  const release = () => {
    held?.release();
    held = null;
  };

  return {
    gate: {
      async mayConnect() {
        const h = await checkClaim(pipe);
        if (stopped) return false;
        report(h);
        return h === null;
      },
      async take() {
        const claim = await takeClaim(pipe, who);
        if (stopped) {
          claim?.release();
          return false;
        }
        held = claim;
        return claim !== null;
      },
      release,
    },
    stop() {
      stopped = true;
      release();
    },
  };
}
