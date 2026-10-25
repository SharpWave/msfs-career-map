import type { RequestHandler } from "express";
import type { SimMode } from "./tracker.ts";
import { currentInputs } from "./inputs.ts";
import { APP_NAME, VERSION } from "./version.ts";

export type StartupStep = "opening" | "bringing-in" | "backing-up" | "upgrading" | "done";
export type AirportDataState = "waiting" | "seeding" | "downloading" | "importing" | "done" | "failed";
export interface AirportDataReport {
  state: AirportDataState;
  list?: "airports" | "runways";
  rows?: number;
  total?: number;
  error?: string;
}
export interface ServerStatus {
  ok: true;
  app: typeof APP_NAME;
  version: string;
  pid: number;
  dataFolder: string;
  logbookId: string | null;
  sim: SimMode;
  startup: StartupStep;
  airportData: AirportDataReport;
  ready: boolean;
  airports: number | null;
  runways: number | null;
}

// Held in memory only, so the status answers while the database is busy or not yet open. A server
// started as a process sets "opening" before it listens; the test servers do no start-up work.
let startup: StartupStep = "done";
let airportData: AirportDataReport = { state: "waiting" };
let preparedAtStart = false;
let counts: { airports: number | null; runways: number | null } = { airports: null, runways: null };
let logbookId: string | null = null;

/** What `GET /api/status` answers, from memory alone; `ready` is worked out at each call. */
// @spec APP-API-004, APP-API-008, APP-API-009, APP-API-010
export function serverStatus(): ServerStatus {
  const inputs = currentInputs();
  return {
    ok: true,
    app: APP_NAME,
    version: VERSION,
    pid: process.pid,
    dataFolder: inputs.dataFolder,
    logbookId,
    sim: inputs.sim,
    startup,
    airportData,
    ready: startup === "done" && preparedAtStart,
    airports: counts.airports,
    runways: counts.runways,
  };
}

export function setStartup(step: StartupStep): void {
  startup = step;
}

/** The preparation's report; the first that has ended, done or failed, ends the preparation at start. */
export function setAirportData(r: AirportDataReport): void {
  airportData = r;
  if (r.state === "done" || r.state === "failed") preparedAtStart = true;
}

/** Called once the database's schema step has run, and after each airport or runway import. */
export function setCounts(c: { airports: number; runways: number }): void {
  counts = { airports: c.airports, runways: c.runways };
}

export function setLogbookId(id: string | null): void {
  logbookId = id;
}

/** GET /api/status, mounted by the full app and the start-up stand-in alike. */
export const statusRoute: RequestHandler = (_req, res) => {
  res.json(serverStatus());
};
