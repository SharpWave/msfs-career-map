/** Defined by the desktop build's esbuild `define` and by Vitest's `define`; absent otherwise. */
declare const __MSFS_CAREER_MAP_VERSION__: string | undefined;

/** The app's version: built in by the desktop build (and the desktop tests); "0.0.0-dev" otherwise. */
export const VERSION: string = typeof __MSFS_CAREER_MAP_VERSION__ === "string" ? __MSFS_CAREER_MAP_VERSION__ : "0.0.0-dev";

/** The `app` the server's /api/status names (APP-API-004). */
export const APP_NAME = "msfs-career-map";
