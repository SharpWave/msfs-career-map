/**
 * Download (if needed) and import the OurAirports airport and runway lists into the local database.
 *
 *   npm run import-airports            # import data/*.csv, downloading any that are missing
 *   npm run import-airports -- --fresh # re-download both first
 */
import { db, DATA_DIR } from "../src/server/db.ts";
import { reimportLists } from "../src/server/airport-data.ts";

const fresh = process.argv.includes("--fresh");
const t0 = Date.now();
const n = await reimportLists(db, DATA_DIR, { fresh });
console.log(`imported ${n.airports} airports and ${n.runways} runways in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
