import path from "node:path";
import type { SimMode } from "./tracker.ts";
import { ROOT } from "./locations.ts";

/** bundled: the installed app and the desktop app's test mode; source: a copy run from source. */
export type ServerForm = "bundled" | "source";
export type BackupsInput = { kind: "folder"; folder: string } | { kind: "documents"; path: string };

/** Everything the server is told at start: where its files are, its port, its sim mode. */
export interface ServerInputs {
  form: ServerForm;
  /** Absolute. */
  dataFolder: string;
  /** Absolute. */
  dbPath: string;
  /** Absolute; null for a copy run from source given none (the page from dist/, no seed lists). */
  programFolder: string | null;
  /** Absolute: <programFolder>/page, or <repo>/dist. */
  pageFolder: string;
  /** 0..65535; 0 is any free port. */
  port: number;
  backups: BackupsInput;
  sim: SimMode;
  /** SIMCONNECT_HOST: a copy run from source on the sim link only. */
  simHost: string | null;
  /** SIMCONNECT_PORT, likewise. */
  simPort: number | null;
  airportDownloads: boolean;
  /** Absolute; the logbook to offer. */
  offer: string | null;
  freshRun: boolean;
}

/** An input the server cannot start with. Its message is the whole line the server writes. */
export class InputError extends Error {}

const VALUE_NAMES = new Set(["data", "program", "port", "backups", "backups-documents", "sim", "airport-downloads", "offer"]);
const SIM_MODES: readonly string[] = ["link", "fake", "off"] satisfies SimMode[];

/**
 * The `--name=value` arguments by name, the last of each winning, and whether `--fresh-run` was
 * given (with any value). Positional and unknown arguments are ignored; a value-taking name given
 * no value, or an empty one, is refused rather than defaulted.
 */
function parseArgs(argv: readonly string[]): { values: Map<string, string>; freshRun: boolean } {
  const values = new Map<string, string>();
  let freshRun = false;
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    const name = eq < 0 ? arg.slice(2) : arg.slice(2, eq);
    if (name === "fresh-run") {
      freshRun = true;
      continue;
    }
    if (!VALUE_NAMES.has(name)) continue;
    const value = eq < 0 ? "" : arg.slice(eq + 1);
    if (value === "") throw new InputError(`Cannot start: --${name} needs a value`);
    values.set(name, value);
  }
  return { values, freshRun };
}

const isPort = (v: string) => /^\d+$/.test(v) && Number(v) <= 65535;

/** `label` is where the value came from: `--port` or `PORT`. */
function portValue(v: string, label: string): number {
  if (!isPort(v)) throw new InputError(`Cannot start: ${label}=${v} is not a port number`);
  return Number(v);
}

function simValue(v: string): SimMode {
  if (!SIM_MODES.includes(v)) throw new InputError(`Cannot start: --sim=${v} is not link, fake or off`);
  return v as SimMode;
}

function downloadsValue(v: string): boolean {
  if (v !== "on" && v !== "off") throw new InputError(`Cannot start: --airport-downloads=${v} is not on or off`);
  return v === "on";
}

/** The backups folder the arguments give, or null when they give none. */
function backupsValue(values: Map<string, string>): BackupsInput | null {
  const folder = values.get("backups");
  const documents = values.get("backups-documents");
  if (folder !== undefined && documents !== undefined) {
    throw new InputError("Cannot start: give --backups or --backups-documents, not both");
  }
  if (folder !== undefined) return { kind: "folder", folder: path.resolve(folder) };
  // Kept as given: Documents is looked up when a backup is taken.
  if (documents !== undefined) return { kind: "documents", path: documents };
  return null;
}

const offerValue = (values: Map<string, string>) => {
  const offer = values.get("offer");
  return offer === undefined ? null : path.resolve(offer);
};

/** The bundled form: every input from the arguments alone, the first missing one refused. */
function bundledInputs(values: Map<string, string>, freshRun: boolean): ServerInputs {
  const need = (name: string) => {
    const v = values.get(name);
    if (v === undefined) throw new InputError(`Cannot start: no --${name} given`);
    return v;
  };
  const dataFolder = path.resolve(need("data"));
  const programFolder = path.resolve(need("program"));
  const port = portValue(need("port"), "--port");
  const backups = backupsValue(values);
  if (!backups) throw new InputError("Cannot start: no --backups or --backups-documents given");
  const sim = simValue(need("sim"));
  const airportDownloads = downloadsValue(need("airport-downloads"));
  return {
    form: "bundled",
    dataFolder,
    dbPath: path.join(dataFolder, "career.db"),
    programFolder,
    pageFolder: path.join(programFolder, "page"),
    port,
    backups,
    sim,
    simHost: null,
    simPort: null,
    airportDownloads,
    offer: offerValue(values),
    freshRun,
  };
}

/**
 * A copy run from source: what the arguments leave out comes from the environment and the
 * repository's own folders, the only place `ROOT` is used for a file the server reads or writes.
 */
function sourceInputs(values: Map<string, string>, freshRun: boolean, env: Readonly<Record<string, string | undefined>>): ServerInputs {
  // A variable that is set but empty counts as unset.
  const fromEnv = (name: string) => (env[name] === "" ? undefined : env[name]);

  let dataFolder: string;
  let dbPath: string;
  const data = values.get("data");
  const careerDb = fromEnv("CAREER_DB");
  if (data !== undefined) {
    dataFolder = path.resolve(data);
    dbPath = path.join(dataFolder, "career.db");
  } else if (careerDb !== undefined) {
    dbPath = path.resolve(careerDb);
    dataFolder = path.dirname(dbPath);
  } else {
    dataFolder = path.join(ROOT, "data");
    dbPath = path.join(dataFolder, "career.db");
  }

  const program = values.get("program");
  const programFolder = program === undefined ? null : path.resolve(program);

  const portArg = values.get("port");
  const portEnv = fromEnv("PORT");
  const port = portArg !== undefined ? portValue(portArg, "--port") : portEnv !== undefined ? portValue(portEnv, "PORT") : 3080;

  const backups = backupsValue(values) ?? { kind: "folder", folder: path.join(dataFolder, "backups") };

  const simArg = values.get("sim");
  const sim: SimMode = simArg !== undefined ? simValue(simArg) : fromEnv("TRACKER_FAKE") === "1" ? "fake" : "off";

  const simConnectPort = fromEnv("SIMCONNECT_PORT");
  const airportDownloads = values.get("airport-downloads");
  return {
    form: "source",
    dataFolder,
    dbPath,
    programFolder,
    pageFolder: programFolder === null ? path.join(ROOT, "dist") : path.join(programFolder, "page"),
    port,
    backups,
    sim,
    // Only the sim link reaches a sim, so only it reads where that sim is.
    simHost: sim === "link" ? fromEnv("SIMCONNECT_HOST")?.trim() || null : null,
    simPort: sim === "link" && simConnectPort !== undefined && isPort(simConnectPort) ? Number(simConnectPort) : null,
    airportDownloads: airportDownloads === undefined ? true : downloadsValue(airportDownloads),
    offer: offerValue(values),
    freshRun,
  };
}

/**
 * The server's inputs from its start-up arguments and, for a copy run from source only, its
 * environment. Pure: it opens and creates nothing, and throws InputError for a start it refuses.
 */
// @spec APP-SRV-006, APP-SRV-007, APP-DATA-001, LIVE-LINK-012, LIVE-LINK-013
export function readInputs(form: ServerForm, argv: readonly string[], env: Readonly<Record<string, string | undefined>>): ServerInputs {
  const { values, freshRun } = parseArgs(argv);
  return form === "bundled" ? bundledInputs(values, freshRun) : sourceInputs(values, freshRun, env);
}

let inputs: ServerInputs | null = null;

/** Set by the server's start before it loads anything that opens the database. */
export function useInputs(i: ServerInputs): void {
  inputs = i;
}

/**
 * The inputs `useInputs` set; otherwise, for the test servers and the tools that load db.ts, those
 * of a copy run from source given no arguments, read once from the environment at the first call
 * (never from `process.argv`).
 */
// @spec APP-SRV-023, APP-SRV-008
export function currentInputs(): ServerInputs {
  return (inputs ??= fallbackInputs(process.env));
}

/**
 * The source form with no arguments, where a `PORT` that is not a port number gives the default
 * port: nothing that takes these inputs listens on it, and loading db.ts must not fail for it. The
 * data folder and the database are worked out apart from the port, by the rules exactly.
 */
function fallbackInputs(env: Readonly<Record<string, string | undefined>>): ServerInputs {
  try {
    return readInputs("source", [], env);
  } catch (e) {
    // With no arguments only PORT can be refused.
    if (!(e instanceof InputError)) throw e;
    return readInputs("source", [], { ...env, PORT: undefined });
  }
}
