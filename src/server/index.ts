import { DB_PATH } from "./db.ts";
import { ensureReferenceData } from "./airports.ts";
import { createApp } from "./app.ts";
import { tracker } from "./tracker.ts";
import { startSimLink } from "./simconnect.ts";

const PORT = Number(process.env.PORT ?? 3080);

/** Connect the SimConnect link to the tracker unless disabled (TRACKER=0) or faked (TRACKER_FAKE=1). */
function startTracking() {
  if (process.env.TRACKER_FAKE === "1") {
    console.log("[sim] TRACKER_FAKE=1: SimConnect disabled; POST /api/tracker/sample feeds the tracker (npm run sim-fake)");
    return;
  }
  if (process.env.TRACKER === "0") {
    console.log("[sim] TRACKER=0: live tracking disabled");
    return;
  }
  startSimLink(
    {
      onSample: (s) => tracker.feed(s),
      onConnect: (name) => {
        console.log(`[sim] connected to ${name}`);
        tracker.setConnected(true, name);
      },
      onDisconnect: (reason) => {
        console.log(`[sim] disconnected: ${reason}`);
        tracker.setConnected(false);
      },
      onPause: (p) => tracker.setPaused(p),
      onSimRunning: (r) => tracker.setSimRunning(r),
      onFlightLoaded: (f) => tracker.flightLoaded(f),
      onLiveryUnsupported: () => tracker.setLiverySupported(false),
      log: (m) => console.log(`[sim] ${m}`),
    },
    {
      host: process.env.SIMCONNECT_HOST || undefined,
      port: process.env.SIMCONNECT_PORT ? Number(process.env.SIMCONNECT_PORT) : undefined,
    },
  );
}

// @spec APP-SRV-001
async function main() {
  await ensureReferenceData();
  startTracking();

  createApp().listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}  (db: ${DB_PATH})`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
