import express from "express";
import { IMAGES_DIR } from "./db.ts";
import { api } from "./routes.ts";
import { requestChecks } from "./checks.ts";
import { currentInputs } from "./inputs.ts";
import { serveImages, servePage } from "./standin.ts";
import { statusRoute } from "./status.ts";

/**
 * Everything the server serves once its start-up work is done: the request checks, the API,
 * uploaded icons and, when built, the page from the inputs' page folder. Building it starts
 * nothing — no listening, no sim link, no data loading — so tests can run it as is.
 */
// @spec APP-SRV-002, APP-SRV-003, APP-SRV-004, APP-API-011, APP-API-012
export function createApp(): express.Express {
  const app = express();
  app.use(requestChecks);
  app.use(express.json({ limit: "8mb" }));
  app.get("/api/status", statusRoute);
  app.use("/api", api);
  serveImages(app, IMAGES_DIR);
  servePage(app, currentInputs().pageFolder);
  return app;
}
