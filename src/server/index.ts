import express from "express";
import fs from "node:fs";
import path from "node:path";
import { ROOT, IMAGES_DIR, DB_PATH } from "./db.ts";
import { ensureReferenceData } from "./airports.ts";
import { api } from "./routes.ts";
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

async function main() {
  await ensureReferenceData();
  startTracking();

  const app = express();
  app.use(express.json({ limit: "8mb" }));
  app.use("/api", api);
  app.use("/images", express.static(IMAGES_DIR, { maxAge: "1y", immutable: true }));

  const dist = path.join(ROOT, "dist");
  if (fs.existsSync(path.join(dist, "index.html"))) {
    app.use(express.static(dist));
    app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
  } else {
    app.get("/", (_req, res) =>
      res.type("text").send(
        "MSFS Career Map API is running.\n" +
          "No client build found: run `npm run dev` for the dev UI on http://localhost:5173, " +
          "or `npm run build` then restart to serve it from here.\n",
      ),
    );
  }

  app.listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}  (db: ${DB_PATH})`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
