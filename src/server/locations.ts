import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..", "..");

export interface DataLocations {
  /** The SQLite file. */
  dbPath: string;
  /** The folder holding it, and everything else the app keeps. */
  dir: string;
  imagesDir: string;
  airportsCsv: string;
  runwaysCsv: string;
}

/**
 * Where the app keeps its data: the database named by `careerDb` (CAREER_DB), else
 * `data/career.db`, with uploaded icons and the OurAirports lists in the same folder, so a copy
 * elsewhere never reads or changes the real logbook's files. Pure: opens and creates nothing.
 */
// @spec APP-DATA-001, APP-DATA-002
export function dataLocations(careerDb: string | undefined): DataLocations {
  const dbPath = careerDb ? path.resolve(careerDb) : path.join(ROOT, "data", "career.db");
  const dir = path.dirname(dbPath);
  return {
    dbPath,
    dir,
    imagesDir: path.join(dir, "images"),
    airportsCsv: path.join(dir, "airports.csv"),
    runwaysCsv: path.join(dir, "runways.csv"),
  };
}
