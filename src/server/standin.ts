import express from "express";
import fs from "node:fs";
import path from "node:path";
import { requestChecks } from "./checks.ts";
import { currentInputs } from "./inputs.ts";
import { dataLocations } from "./locations.ts";
import { serverStatus, statusRoute } from "./status.ts";

/** Uploaded icons from `dir`; a missing one is a 404, never the page. */
export function serveImages(app: express.Express, dir: string): void {
  app.use("/images", express.static(dir, { maxAge: "1y", immutable: true }));
  app.use("/images", (_req, res) => {
    res.status(404).json({ error: "not found" });
  });
}

/**
 * The page from `folder`, the same way in the full app and the stand-in: its files, and its
 * `index.html` for every other GET outside `/api` and `/images` (mounted before this); with no
 * build there, a plain-text note on `/` saying how to get one.
 */
// @spec APP-SRV-003
export function servePage(app: express.Express, folder: string): void {
  const index = path.join(folder, "index.html");
  if (fs.existsSync(index)) {
    app.use(express.static(folder));
    app.get("*", (_req, res) => res.sendFile(index));
  } else {
    app.get("/", (_req, res) =>
      res.type("text").send(
        "MSFS Career Map API is running.\n" +
          "No page build found: run `npm run dev` for the page on http://127.0.0.1:5173, " +
          "or `npm run build` and start again to serve it from here.\n",
      ),
    );
  }
}

/**
 * What the server answers while its start-up work is under way: the request checks, the status,
 * a 503 for the rest of the API, the icons and the page. It imports nothing that holds the
 * database, so it can answer before the logbook is open. Building it starts nothing.
 */
// @spec APP-SRV-009
export function createStandIn(): express.Express {
  const inputs = currentInputs();
  const app = express();
  app.use(requestChecks);
  app.get("/api/status", statusRoute);
  app.use("/api", (_req, res) => {
    res
      .status(503)
      .set("Retry-After", "1")
      .json({ error: `MSFS Career Map is starting (${serverStatus().startup})` });
  });
  serveImages(app, dataLocations(inputs.dbPath).imagesDir);
  servePage(app, inputs.pageFolder);
  return app;
}
