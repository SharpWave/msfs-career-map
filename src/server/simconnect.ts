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
 * asks for the user aircraft's position once a second, and hands each sample plus a few system
 * events to the caller. It knows nothing about hops; see tracker.ts for that.
 */

export interface SimAircraft {
  /** `TITLE` from aircraft.cfg, e.g. "Cessna 172 Skyhawk G1000". */
  title: string;
  /** `LIVERY NAME` (MSFS 2024); empty when the sim does not report it. */
  livery: string;
  /** `ATC ID`: the registration painted on the aircraft. */
  atc_id: string;
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
const REQ_POSITION = 1;
const REQ_LIVERY = 2;
const EV_PAUSE = 1;
const EV_SIM = 2;
const EV_FLIGHT_LOADED = 3;

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

        const add = (def: number, name: string, units: string | null, type: SimConnectDataType) =>
          hd.addToDataDefinition(def, name, units, type, 0, SimConnectConstants.UNUSED);
        add(DEF_POSITION, "PLANE LATITUDE", "degrees", SimConnectDataType.FLOAT64);
        add(DEF_POSITION, "PLANE LONGITUDE", "degrees", SimConnectDataType.FLOAT64);
        add(DEF_POSITION, "PLANE ALTITUDE", "feet", SimConnectDataType.FLOAT64);
        add(DEF_POSITION, "SIM ON GROUND", "bool", SimConnectDataType.INT32);
        add(DEF_POSITION, "GROUND VELOCITY", "knots", SimConnectDataType.FLOAT64);
        add(DEF_POSITION, "PLANE HEADING DEGREES TRUE", "degrees", SimConnectDataType.FLOAT64);
        add(DEF_POSITION, "TITLE", null, SimConnectDataType.STRING128);
        add(DEF_POSITION, "ATC ID", null, SimConnectDataType.STRING32);
        // Livery lives in its own definition so a sim that lacks the variable only loses that field.
        const liverySendId = add(DEF_LIVERY, "LIVERY NAME", null, SimConnectDataType.STRING128);

        hd.requestDataOnSimObject(REQ_POSITION, DEF_POSITION, SimConnectConstants.OBJECT_ID_USER, SimConnectPeriod.SECOND, 0, 0, 0, 0);
        hd.requestDataOnSimObject(REQ_LIVERY, DEF_LIVERY, SimConnectConstants.OBJECT_ID_USER, SimConnectPeriod.SECOND, 0, 0, 0, 0);
        hd.subscribeToSystemEvent(EV_PAUSE, "Pause");
        hd.subscribeToSystemEvent(EV_SIM, "Sim");
        hd.subscribeToSystemEvent(EV_FLIGHT_LOADED, "FlightLoaded");

        hd.on("simObjectData", (d) => {
          if (d.requestID === REQ_LIVERY) {
            livery = d.data.readString128().trim();
            return;
          }
          if (d.requestID !== REQ_POSITION) return;
          const lat = d.data.readFloat64();
          const lon = d.data.readFloat64();
          const alt_ft = d.data.readFloat64();
          const on_ground = d.data.readInt32() !== 0;
          const gs_kts = d.data.readFloat64();
          const hdg_deg = d.data.readFloat64();
          const title = d.data.readString128().trim();
          const atc_id = d.data.readString32().trim();
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
          h.onSample({ t: Date.now(), lat, lon, alt_ft, on_ground, gs_kts, hdg_deg, title, livery, atc_id });
        });

        hd.on("event", (e) => {
          if (e.clientEventId === EV_PAUSE) h.onPause?.(e.data === 1);
          else if (e.clientEventId === EV_SIM) h.onSimRunning?.(e.data === 1);
        });
        hd.on("eventFilename", (e) => {
          if (e.clientEventId === EV_FLIGHT_LOADED) h.onFlightLoaded?.(e.fileName);
        });
        hd.on("exception", (ex) => {
          if (ex.sendId === liverySendId) h.onLiveryUnsupported?.();
          else log(`SimConnect exception ${ex.exception} (send ${ex.sendId}, index ${ex.index})`);
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
