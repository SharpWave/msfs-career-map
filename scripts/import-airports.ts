/**
 * Download (if needed) and import the OurAirports airport and runway lists into the local database.
 *
 *   npm run import-airports            # import data/*.csv, downloading any that are missing
 *   npm run import-airports -- --fresh # re-download both first
 */
import fs from "node:fs";
import { AIRPORTS_CSV, RUNWAYS_CSV } from "../src/server/db.ts";
import { downloadAirportsCsv, downloadRunwaysCsv, importAirportsCsv, importRunwaysCsv } from "../src/server/airports.ts";

const fresh = process.argv.includes("--fresh");
if (fresh || !fs.existsSync(AIRPORTS_CSV)) await downloadAirportsCsv();
if (fresh || !fs.existsSync(RUNWAYS_CSV)) await downloadRunwaysCsv();

let t0 = Date.now();
console.log(`imported ${importAirportsCsv()} airports in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
t0 = Date.now();
console.log(`imported ${importRunwaysCsv()} runways in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
