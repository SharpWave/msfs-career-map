import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** The API server the dev page talks to: the same `PORT` the server listens on. */
const api = `http://localhost:${process.env.PORT || 3080}`;

// @spec APP-RUN-001
export default defineConfig({
  root: "src/client",
  plugins: [react()],
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // With the trailing slash, so the page's own modules (/api.ts) stay here.
      "/api/": api,
      "/images/": api,
    },
  },
});
