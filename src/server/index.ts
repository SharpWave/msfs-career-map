import express from "express";
import fs from "node:fs";
import path from "node:path";
import { ROOT, IMAGES_DIR, DB_PATH } from "./db.ts";
import { ensureAirports } from "./airports.ts";
import { api } from "./routes.ts";

const PORT = Number(process.env.PORT ?? 3080);

async function main() {
  await ensureAirports();

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
