/**
 * Connection probe: prints what the sim reports once a second, without touching the database.
 *
 *   npm run sim-probe
 *   SIMCONNECT_HOST=192.168.1.20 SIMCONNECT_PORT=500 npm run sim-probe   (sim on another PC)
 *
 * Ctrl+C to stop.
 */
import { startSimLink } from "../src/server/simconnect.ts";

const stamp = () => new Date().toLocaleTimeString();
let n = 0;

const link = startSimLink(
  {
    onConnect: (name) => console.log(`${stamp()} connected to ${name}`),
    onDisconnect: (reason) => console.log(`${stamp()} disconnected: ${reason}`),
    onPause: (p) => console.log(`${stamp()} ${p ? "paused" : "unpaused"}`),
    onSimRunning: (r) => console.log(`${stamp()} sim ${r ? "running" : "stopped (menus/loading)"}`),
    onFlightLoaded: (f) => console.log(`${stamp()} flight loaded: ${f}`),
    onLiveryUnsupported: () => console.log(`${stamp()} LIVERY NAME not supported by this sim; liveries will read as ""`),
    log: (m) => console.log(`${stamp()} ${m}`),
    onSample: (s) => {
      n++;
      console.log(
        `${stamp()} #${n} ${s.title || "(no title)"}${s.livery ? ` | ${s.livery}` : ""}${s.atc_id ? ` | ${s.atc_id}` : ""}` +
          ` | ${s.lat.toFixed(5)}, ${s.lon.toFixed(5)} | ${Math.round(s.alt_ft)} ft | ${Math.round(s.gs_kts)} kt | hdg ${Math.round(s.hdg_deg)}` +
          ` | ${s.on_ground ? "on ground" : "AIRBORNE"}`,
      );
    },
  },
  {
    host: process.env.SIMCONNECT_HOST || undefined,
    port: process.env.SIMCONNECT_PORT ? Number(process.env.SIMCONNECT_PORT) : undefined,
    retryMs: 5000,
    appName: "MSFS Career Map probe",
  },
);

process.on("SIGINT", () => {
  link.stop();
  console.log(`stopped after ${n} samples`);
  process.exit(0);
});
