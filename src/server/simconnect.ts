import {
  open,
  Protocol,
  SimConnectConstants,
  SimConnectDataType,
  SimConnectPeriod,
  type SimConnectConnection,
} from "node-simconnect";

/**
 * Thin SimConnect link: opens a connection to the sim (retrying quietly while it is not running),
 * asks for the user aircraft's state once a second, watches a few variables every frame to catch
 * the exact moment of touchdown, and hands samples plus system events to the caller. A record it
 * cannot read is dropped and written out, never passed on. It knows nothing about hops; see
 * tracker.ts for that.
 */

export interface SimAircraft {
  /** `TITLE` from aircraft.cfg, e.g. "Cessna 172 Skyhawk G1000". */
  title: string;
  /** `LIVERY NAME` (MSFS 2024); empty when the sim does not report it. */
  livery: string;
  /** `ATC ID`: the registration painted on the aircraft. */
  atc_id: string;
}

/** What the frame-rate watcher measured at the last touchdown. */
export interface Touchdown {
  /** Epoch ms of the on-ground flip, from the frame stream. */
  t: number;
  /** Descent rate on the last airborne frame, feet per minute, positive down. */
  fpm: number;
  /** Peak load factor in the second after the wheels touched. */
  g: number;
  ias_kts: number;
  /** The sim's own PLANE TOUCHDOWN NORMAL VELOCITY as fpm, when it reported one. */
  sim_fpm: number | null;
  pitch_deg: number | null;
  bank_deg: number | null;
}

export interface SimSample extends SimAircraft {
  /** Wall-clock time the sample arrived, epoch ms. */
  t: number;
  lat: number;
  lon: number;
  /** True altitude, feet MSL. */
  alt_ft: number;
  on_ground: boolean;
  gs_kts: number;
  hdg_deg: number;
  /** Feet per minute, positive up. */
  vs_fpm: number;
  ias_kts: number;
  /** Load factor. */
  g: number;
  fuel_lb: number;
  weight_lb: number;
  /** Set on the first sample after a touchdown the frame watcher caught. */
  touchdown?: Touchdown;
}

export interface SimLinkHandlers {
  onSample(s: SimSample): void;
  onConnect(appName: string): void;
  /**
   * The connection ended. `quit` is true only for SimConnect's quit event (MSFS closing normally);
   * a connection that closed or failed (a sim crash, a lost connection) gives false.
   */
  onDisconnect(reason: string, quit: boolean): void;
  onPause?(paused: boolean): void;
  /** `Sim` system event: false while the sim sits in menus or a loading screen. */
  onSimRunning?(running: boolean): void;
  onFlightLoaded?(file: string): void;
  /** The sim rejected the LIVERY NAME variable (MSFS 2020); liveries will read as "". */
  onLiveryUnsupported?(): void;
  log?(msg: string): void;
}

export interface SimLinkOptions {
  /** Set both to reach a sim on another PC over TCP; otherwise SimConnect.cfg / the registry decide. */
  host?: string;
  port?: number;
  retryMs?: number;
  appName?: string;
}

const DEF_POSITION = 1;
const DEF_LIVERY = 2;
const DEF_FRAME = 3;
const REQ_POSITION = 1;
const REQ_LIVERY = 2;
const REQ_FRAME = 3;
const EV_PAUSE = 1;
const EV_SIM = 2;
const EV_FLIGHT_LOADED = 3;

/** How long after the wheels touch to keep looking for the peak G. */
const G_WINDOW_MS = 1000;
/** How long a new connection holds samples waiting for the first livery reading. */
const LIVERY_WAIT_MS = 5000;

/** Each data definition, as the lines about records the link cannot read name it. */
type RecordKind = "position" | "livery" | "per-frame";

/**
 * Start the link. It keeps reconnecting until `stop()` is called; from then on it calls no handler,
 * whatever the old connection still sends.
 */
export function startSimLink(h: SimLinkHandlers, o: SimLinkOptions = {}): { stop(): void; connected(): boolean } {
  const retryMs = o.retryMs ?? 10000;
  const options = o.host ? { remote: { host: o.host, port: o.port ?? 500 } } : undefined;

  let stopped = false;
  let handle: SimConnectConnection | null = null;
  let timer: NodeJS.Timeout | null = null;
  let attempts = 0;
  /** The open connection's count of the records it dropped, written once when it ends or the link stops. */
  let writeDropped: (() => void) | null = null;

  // @spec LIVE-LINK-016
  // Every call into the caller goes through here. An error in the caller's handling of one sample
  // or event is written out and goes no further: thrown from a SimConnect listener it would end the
  // server, and thrown while connecting it would be taken for an unreachable sim and retried.
  const call = (what: string, fn: () => void) => {
    if (stopped) return;
    try {
      fn();
    } catch (e) {
      console.error(`[sim] ${what} failed:`, e);
    }
  };
  const log = (msg: string) => call("log", () => h.log?.(msg));

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(connect, retryMs);
  };

  const connect = () => {
    timer = null;
    if (stopped) return;
    open(o.appName ?? "MSFS Career Map", Protocol.FSX_SP2, options)
      .then(({ recvOpen, handle: hd }) => {
        if (stopped) {
          // Stopped while this attempt was opening: close it unseen.
          try {
            hd.close();
          } catch {
            /* already closed */
          }
          return;
        }
        handle = hd;
        attempts = 0;
        let livery = "";
        let closed = false;
        /** Whether what this connection sends still goes anywhere: not once it ended or the link stopped. */
        const live = () => !closed && !stopped;
        const pass = (s: SimSample) => call("onSample", () => h.onSample(s));

        // @spec LIVE-LINK-018
        // A record the reader cannot read (one shorter than its definition) is dropped whole: the
        // first of each definition on this connection is written out with its bytes, later ones
        // only counted, and the counts written when the connection ends or the link stops.
        const dropped = new Map<RecordKind, number>();
        const drop = (kind: RecordKind, e: unknown, data: { buffer?: unknown }) => {
          const n = (dropped.get(kind) ?? 0) + 1;
          dropped.set(kind, n);
          if (n > 1) return;
          // The RawBuffer's own buffer is the whole record (its length is the reader's limit);
          // getBuffer() would give only the part read before the read that threw.
          let hex = "(record bytes unavailable)";
          try {
            const bytes = data.buffer;
            if (Buffer.isBuffer(bytes)) hex = bytes.toString("hex");
          } catch {
            /* the record cannot give its bytes either */
          }
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[sim] dropped a " + kind + " record the link cannot read (" + msg + "): " + hex);
        };
        const writeCounts = () => {
          for (const [kind, n] of dropped) {
            console.error("[sim] dropped " + n + " " + kind + " record" + (n === 1 ? "" : "s") + " the link could not read on that connection");
          }
          dropped.clear();
        };
        writeDropped = writeCounts;
        /** The record's values, read by `fn`, or null when it cannot be read (and is dropped). */
        const readRecord = <T>(kind: RecordKind, data: unknown, fn: () => T): T | null => {
          try {
            return fn();
          } catch (e) {
            drop(kind, e, data as { buffer?: unknown });
            return null;
          }
        };

        // @spec LIVE-LEG-012, LIVE-LINK-009
        // The livery comes in its own request, so the first samples of a connection can arrive
        // before it. Hold them until it is read (or refused), so the tracker never takes a livery
        // not yet read for a change of aircraft; give up waiting after LIVERY_WAIT_MS.
        let liveryKnown = false;
        let held: Omit<SimSample, "livery">[] = [];
        const release = () => {
          liveryKnown = true;
          const out = held;
          held = [];
          for (const s of out) pass({ ...s, livery });
        };

        // sendId → datum name, so a rejected variable can be named in the log.
        const datumBySend = new Map<number, string>();
        const add = (def: number, name: string, units: string | null, type: SimConnectDataType) => {
          const id = hd.addToDataDefinition(def, name, units, type, 0, SimConnectConstants.UNUSED);
          datumBySend.set(id, name);
          return id;
        };

        // Once a second: where the aircraft is and what it is.
        add(DEF_POSITION, "PLANE LATITUDE", "degrees", SimConnectDataType.FLOAT64);
        add(DEF_POSITION, "PLANE LONGITUDE", "degrees", SimConnectDataType.FLOAT64);
        add(DEF_POSITION, "PLANE ALTITUDE", "feet", SimConnectDataType.FLOAT64);
        add(DEF_POSITION, "SIM ON GROUND", "bool", SimConnectDataType.INT32);
        add(DEF_POSITION, "GROUND VELOCITY", "knots", SimConnectDataType.FLOAT64);
        add(DEF_POSITION, "PLANE HEADING DEGREES TRUE", "degrees", SimConnectDataType.FLOAT64);
        add(DEF_POSITION, "VERTICAL SPEED", "feet per minute", SimConnectDataType.FLOAT64);
        add(DEF_POSITION, "AIRSPEED INDICATED", "knots", SimConnectDataType.FLOAT64);
        add(DEF_POSITION, "G FORCE", "gforce", SimConnectDataType.FLOAT64);
        add(DEF_POSITION, "FUEL TOTAL QUANTITY WEIGHT", "pounds", SimConnectDataType.FLOAT64);
        add(DEF_POSITION, "TOTAL WEIGHT", "pounds", SimConnectDataType.FLOAT64);
        add(DEF_POSITION, "PLANE TOUCHDOWN NORMAL VELOCITY", "feet per second", SimConnectDataType.FLOAT64);
        add(DEF_POSITION, "PLANE TOUCHDOWN PITCH DEGREES", "degrees", SimConnectDataType.FLOAT64);
        add(DEF_POSITION, "PLANE TOUCHDOWN BANK DEGREES", "degrees", SimConnectDataType.FLOAT64);
        add(DEF_POSITION, "TITLE", null, SimConnectDataType.STRING128);
        add(DEF_POSITION, "ATC ID", null, SimConnectDataType.STRING32);
        // Livery lives in its own definition so a sim that lacks the variable only loses that field.
        const liverySendId = add(DEF_LIVERY, "LIVERY NAME", null, SimConnectDataType.STRING128);
        // Every frame: just enough to catch the touchdown.
        add(DEF_FRAME, "SIM ON GROUND", "bool", SimConnectDataType.INT32);
        add(DEF_FRAME, "VERTICAL SPEED", "feet per minute", SimConnectDataType.FLOAT64);
        add(DEF_FRAME, "G FORCE", "gforce", SimConnectDataType.FLOAT64);
        add(DEF_FRAME, "AIRSPEED INDICATED", "knots", SimConnectDataType.FLOAT64);

        hd.requestDataOnSimObject(REQ_POSITION, DEF_POSITION, SimConnectConstants.OBJECT_ID_USER, SimConnectPeriod.SECOND, 0, 0, 0, 0);
        hd.requestDataOnSimObject(REQ_LIVERY, DEF_LIVERY, SimConnectConstants.OBJECT_ID_USER, SimConnectPeriod.SECOND, 0, 0, 0, 0);
        hd.requestDataOnSimObject(REQ_FRAME, DEF_FRAME, SimConnectConstants.OBJECT_ID_USER, SimConnectPeriod.SIM_FRAME, 0, 0, 0, 0);
        hd.subscribeToSystemEvent(EV_PAUSE, "Pause");
        hd.subscribeToSystemEvent(EV_SIM, "Sim");
        hd.subscribeToSystemEvent(EV_FLIGHT_LOADED, "FlightLoaded");

        // Touchdown watcher state (frame stream).
        let frameGround: boolean | null = null;
        let lastAirVs = 0;
        let lastAirIas = 0;
        let capture: { t: number; fpm: number; ias_kts: number; g: number; until: number } | null = null;
        let pending: Touchdown | null = null;

        hd.on("simObjectData", (d) => {
          if (!live()) return;
          if (d.requestID === REQ_LIVERY) {
            const read = readRecord("livery", d.data, () => d.data.readString128().trim());
            if (read == null) return;
            livery = read;
            if (!liveryKnown) release();
            return;
          }
          if (d.requestID === REQ_FRAME) {
            const now = Date.now();
            const frame = readRecord("per-frame", d.data, () => ({
              ground: d.data.readInt32() !== 0,
              vs: d.data.readFloat64(),
              g: d.data.readFloat64(),
              ias: d.data.readFloat64(),
            }));
            if (!frame) return;
            const { ground, vs, g, ias } = frame;
            if (capture) {
              capture.g = Math.max(capture.g, g);
              if (now >= capture.until) {
                pending = { t: capture.t, fpm: capture.fpm, g: capture.g, ias_kts: capture.ias_kts, sim_fpm: null, pitch_deg: null, bank_deg: null };
                capture = null;
              }
            }
            if (frameGround === false && ground && !capture) {
              capture = { t: now, fpm: Math.max(0, -lastAirVs), ias_kts: lastAirIas, g, until: now + G_WINDOW_MS };
            }
            if (!ground) {
              lastAirVs = vs;
              lastAirIas = ias;
            }
            frameGround = ground;
            return;
          }
          if (d.requestID !== REQ_POSITION) return;
          const rec = readRecord("position", d.data, () => ({
            lat: d.data.readFloat64(),
            lon: d.data.readFloat64(),
            alt_ft: d.data.readFloat64(),
            on_ground: d.data.readInt32() !== 0,
            gs_kts: d.data.readFloat64(),
            hdg_deg: d.data.readFloat64(),
            vs_fpm: d.data.readFloat64(),
            ias_kts: d.data.readFloat64(),
            g: d.data.readFloat64(),
            fuel_lb: d.data.readFloat64(),
            weight_lb: d.data.readFloat64(),
            tdNormalFps: d.data.readFloat64(),
            tdPitch: d.data.readFloat64(),
            tdBank: d.data.readFloat64(),
            title: d.data.readString128().trim(),
            atc_id: d.data.readString32().trim(),
          }));
          if (!rec) return;
          const { lat, lon, alt_ft, on_ground, gs_kts, hdg_deg, vs_fpm, ias_kts, g, fuel_lb, weight_lb, tdNormalFps, tdPitch, tdBank, title, atc_id } = rec;
          if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(alt_ft)) return;
          const sample: Omit<SimSample, "livery"> = {
            t: Date.now(),
            lat,
            lon,
            alt_ft,
            on_ground,
            gs_kts,
            hdg_deg,
            vs_fpm,
            ias_kts,
            g,
            fuel_lb,
            weight_lb,
            title,
            atc_id,
          };
          if (pending) {
            sample.touchdown = {
              ...pending,
              sim_fpm: Number.isFinite(tdNormalFps) ? Math.round(Math.abs(tdNormalFps) * 60) : null,
              pitch_deg: Number.isFinite(tdPitch) ? tdPitch : null,
              bank_deg: Number.isFinite(tdBank) ? tdBank : null,
            };
            pending = null;
          }
          if (liveryKnown) {
            pass({ ...sample, livery });
            return;
          }
          held.push(sample);
          if (sample.t - held[0].t >= LIVERY_WAIT_MS) {
            log(`no livery reported ${LIVERY_WAIT_MS / 1000} s after connecting; tracking with a blank livery`);
            release();
          }
        });

        hd.on("event", (e) => {
          if (!live()) return;
          if (e.clientEventId === EV_PAUSE) call("onPause", () => h.onPause?.(e.data === 1));
          else if (e.clientEventId === EV_SIM) call("onSimRunning", () => h.onSimRunning?.(e.data === 1));
        });
        hd.on("eventFilename", (e) => {
          if (!live()) return;
          if (e.clientEventId === EV_FLIGHT_LOADED) call("onFlightLoaded", () => h.onFlightLoaded?.(e.fileName));
        });
        hd.on("exception", (ex) => {
          if (!live()) return;
          if (ex.sendId === liverySendId) {
            call("onLiveryUnsupported", () => h.onLiveryUnsupported?.());
            if (!liveryKnown) release();
          } else {
            const datum = datumBySend.get(ex.sendId);
            log(`SimConnect exception ${ex.exceptionName ?? ex.exception}${datum ? ` on "${datum}"` : ` (send ${ex.sendId}, index ${ex.index})`}`);
          }
        });

        // @spec LIVE-LINK-007
        // The connection ending, told apart by how: only SimConnect's quit event is MSFS closing
        // normally. After `stop()` none of them is passed on: closing the handle is not the sim's doing.
        const gone = (reason: string, quit: boolean) => {
          if (!live()) return;
          closed = true;
          handle = null;
          writeDropped = null;
          writeCounts();
          try {
            hd.close();
          } catch {
            /* already closed */
          }
          call("onDisconnect", () => h.onDisconnect(reason, quit));
          schedule();
        };
        // Listeners stay on after the end, so a late "error" from the old handle never goes unheard.
        hd.on("quit", () => gone("the simulator quit", true));
        hd.on("close", () => gone("the connection closed", false));
        hd.on("error", (e: unknown) => gone(`error: ${e instanceof Error ? e.message : String(e)}`, false));

        call("onConnect", () => h.onConnect(recvOpen.applicationName));
      })
      .catch((e: unknown) => {
        if (stopped) return;
        attempts++;
        const msg = e instanceof Error ? e.message : String(e);
        if (attempts === 1) log(`sim not reachable (${msg}); retrying every ${Math.round(retryMs / 1000)} s`);
        schedule();
      });
  };

  connect();

  return {
    // @spec LIVE-LINK-011
    // Marked stopped before the handle closes, so the close it brings on, and anything else the old
    // handle still sends (data, the per-frame watcher's, sim events), reaches no handler and no
    // reconnect follows: the caller is left as it was before the stop, not told of a disconnect.
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      const hd = handle;
      handle = null;
      // @spec LIVE-LINK-018
      const counts = writeDropped;
      writeDropped = null;
      if (hd) counts?.();
      try {
        hd?.close();
      } catch {
        /* ignore */
      }
    },
    connected: () => handle !== null,
  };
}
