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
 * the exact moment of touchdown, and hands samples plus system events to the caller. It knows
 * nothing about hops; see tracker.ts for that.
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
  onDisconnect(reason: string): void;
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

/** Start the link. It keeps reconnecting until `stop()` is called. */
export function startSimLink(h: SimLinkHandlers, o: SimLinkOptions = {}): { stop(): void; connected(): boolean } {
  const retryMs = o.retryMs ?? 10000;
  const log = h.log ?? (() => {});
  const options = o.host ? { remote: { host: o.host, port: o.port ?? 500 } } : undefined;

  let stopped = false;
  let handle: SimConnectConnection | null = null;
  let timer: NodeJS.Timeout | null = null;
  let attempts = 0;

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(connect, retryMs);
  };

  const connect = () => {
    timer = null;
    if (stopped) return;
    open(o.appName ?? "MSFS Career Map", Protocol.FSX_SP2, options)
      .then(({ recvOpen, handle: hd }) => {
        handle = hd;
        attempts = 0;
        let livery = "";
        let closed = false;

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
          for (const s of out) h.onSample({ ...s, livery });
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
          if (d.requestID === REQ_LIVERY) {
            livery = d.data.readString128().trim();
            if (!liveryKnown) release();
            return;
          }
          if (d.requestID === REQ_FRAME) {
            const now = Date.now();
            const ground = d.data.readInt32() !== 0;
            const vs = d.data.readFloat64();
            const g = d.data.readFloat64();
            const ias = d.data.readFloat64();
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
          const lat = d.data.readFloat64();
          const lon = d.data.readFloat64();
          const alt_ft = d.data.readFloat64();
          const on_ground = d.data.readInt32() !== 0;
          const gs_kts = d.data.readFloat64();
          const hdg_deg = d.data.readFloat64();
          const vs_fpm = d.data.readFloat64();
          const ias_kts = d.data.readFloat64();
          const g = d.data.readFloat64();
          const fuel_lb = d.data.readFloat64();
          const weight_lb = d.data.readFloat64();
          const tdNormalFps = d.data.readFloat64();
          const tdPitch = d.data.readFloat64();
          const tdBank = d.data.readFloat64();
          const title = d.data.readString128().trim();
          const atc_id = d.data.readString32().trim();
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
            h.onSample({ ...sample, livery });
            return;
          }
          held.push(sample);
          if (sample.t - held[0].t >= LIVERY_WAIT_MS) {
            log(`no livery reported ${LIVERY_WAIT_MS / 1000} s after connecting; tracking with a blank livery`);
            release();
          }
        });

        hd.on("event", (e) => {
          if (e.clientEventId === EV_PAUSE) h.onPause?.(e.data === 1);
          else if (e.clientEventId === EV_SIM) h.onSimRunning?.(e.data === 1);
        });
        hd.on("eventFilename", (e) => {
          if (e.clientEventId === EV_FLIGHT_LOADED) h.onFlightLoaded?.(e.fileName);
        });
        hd.on("exception", (ex) => {
          if (ex.sendId === liverySendId) {
            h.onLiveryUnsupported?.();
            if (!liveryKnown) release();
          } else {
            const datum = datumBySend.get(ex.sendId);
            log(`SimConnect exception ${ex.exceptionName ?? ex.exception}${datum ? ` on "${datum}"` : ` (send ${ex.sendId}, index ${ex.index})`}`);
          }
        });

        const gone = (reason: string) => {
          if (closed) return;
          closed = true;
          handle = null;
          try {
            hd.close();
          } catch {
            /* already closed */
          }
          h.onDisconnect(reason);
          schedule();
        };
        hd.on("quit", () => gone("the simulator quit"));
        hd.on("close", () => gone("the connection closed"));
        hd.on("error", (e: unknown) => gone(`error: ${e instanceof Error ? e.message : String(e)}`));

        h.onConnect(recvOpen.applicationName);
      })
      .catch((e: unknown) => {
        attempts++;
        const msg = e instanceof Error ? e.message : String(e);
        if (attempts === 1) log(`sim not reachable (${msg}); retrying every ${Math.round(retryMs / 1000)} s`);
        schedule();
      });
  };

  connect();

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      try {
        handle?.close();
      } catch {
        /* ignore */
      }
      handle = null;
    },
    connected: () => handle !== null,
  };
}
