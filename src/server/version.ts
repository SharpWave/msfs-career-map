import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./locations.ts";

/** Defined by the desktop build, which bundles the server into one file; absent when run from source. */
declare const __MSFS_CAREER_MAP_VERSION__: string | undefined;

export const APP_NAME = "msfs-career-map";

/** The app version: built into the bundle, else read once from the repository's package.json. */
// @spec APP-API-005
export const VERSION: string =
  typeof __MSFS_CAREER_MAP_VERSION__ === "string"
    ? __MSFS_CAREER_MAP_VERSION__
    : (JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version: string }).version;
