import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { pagePackages } from "./scripts/page-packages.ts";

/** The app's version, built into the page (APP-API-005). */
const version: string = JSON.parse(fs.readFileSync(new URL("./package.json", import.meta.url), "utf8")).version;

/** The API server the dev page talks to: the same `PORT` the server listens on, on 127.0.0.1 only. */
const api = `http://127.0.0.1:${process.env.PORT || 3080}`;

// @spec APP-RUN-001, DESK-DIST-PKG-025
export default defineConfig({
  root: "src/client",
  // The record of the page's packages, for the desktop build's third-party notices.
  plugins: [react(), pagePackages(fileURLToPath(new URL(".", import.meta.url)))],
  define: { __MSFS_CAREER_MAP_VERSION__: JSON.stringify(version) },
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      // With the trailing slash, so the page's own modules (/api.ts) stay here.
      "/api/": api,
      "/images/": api,
    },
  },
});
