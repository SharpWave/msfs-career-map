/**
 * Download (if needed) and import the OurAirports airport list into the local database.
 *
 *   npm run import-airports            # import data/airports.csv, downloading it if missing
 *   npm run import-airports -- --fresh # re-download first
 */
import fs from "node:fs";
import { AIRPORTS_CSV } from "../src/server/db.ts";
import { downloadAirportsCsv, importAirportsCsv } from "../src/server/airports.ts";

const fresh = process.argv.includes("--fresh");
if (fresh || !fs.existsSync(AIRPORTS_CSV)) await downloadAirportsCsv();
const t0 = Date.now();
const n = importAirportsCsv();
console.log(`imported ${n} airports in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
