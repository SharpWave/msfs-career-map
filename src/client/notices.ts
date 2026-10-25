/** What the page says about its server: starting, airport preparation, another version. */

/** How often the page asks the server, and how long it waits for one bringing a logbook in. */
export const PAGE_TIMING = {
  /** A first load answered 503: load again this often (APP-UI-030). */
  startingRetryMs: 1000,
  /** Airport preparation not done: ask `/api/status` this often (APP-UI-031). */
  airportPollMs: 2000,
  /** Waiting for the server to come back with a logbook brought in (APP-UI-040). */
  restartPollMs: 1000,
  restartGiveUpMs: 60_000,
};

export type StartupStep = "opening" | "bringing-in" | "backing-up" | "upgrading" | "done";

const STEPS: Partial<Record<StartupStep, string>> = {
  opening: "opening the logbook",
  "bringing-in": "bringing in the logbook",
  "backing-up": "backing up the logbook",
  upgrading: "upgrading the logbook",
};

/** "Starting… (<step>)" while the server's start-up work runs, or "Starting…" with no step known. */
// @spec APP-UI-030
export function startingText(step: string | null): string {
  const s = step ? STEPS[step as StartupStep] : undefined;
  return s ? `Starting… (${s})` : "Starting…";
}

export interface AirportDataReport {
  state: string;
  list?: string;
  rows?: number;
  total?: number;
  error?: string;
}

const count = (n: number | undefined) => (n ?? 0).toLocaleString("en-US");

/** The notice for airport preparation under way or failed; null once it is done or before it starts. */
// @spec APP-UI-031
export function airportNotice(r: AirportDataReport | null | undefined): string | null {
  if (!r) return null;
  let step: string;
  switch (r.state) {
    case "seeding":
      step = "copying the airport lists";
      break;
    case "downloading":
      step = `downloading the ${r.list} list`;
      break;
    case "importing":
      step = `importing ${r.list}: ${count(r.rows)} of ${count(r.total)}`;
      break;
    case "failed":
      return `Airport data could not be prepared: ${r.error ?? "unknown error"}`;
    default:
      return null;
  }
  return `Preparing airport data: ${step}. Airport searches work once this finishes.`;
}

/** The notice for a page whose reload for the server's version brought back the same page. */
// @spec APP-UI-036
export function versionNotice(page: string, server: string): string {
  return `This page is version ${page}; the server runs version ${server}. Reload the page once it is rebuilt.`;
}
