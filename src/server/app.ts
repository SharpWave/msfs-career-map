import express from "express";
import fs from "node:fs";
import path from "node:path";
import { ROOT, IMAGES_DIR } from "./db.ts";
import { api } from "./routes.ts";

/**
 * Everything the server serves: the API, uploaded icons and, when built, the page. Building it
 * starts nothing — no listening, no sim link, no data loading — so tests can run it as is.
 */
// @spec APP-SRV-002, APP-SRV-003, APP-SRV-004
export function createApp(): express.Express {
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
  return app;
}
