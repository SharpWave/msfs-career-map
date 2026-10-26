/**
 * The server as the page meets it in component tests: `/api/state`, `/api/status`, the logbook
 * offer and the calls the planner and the live card make as they mount, answered from values the
 * test can change between calls. Free of vi.mock: each test file stands in for the map and the
 * tracker stream itself.
 */
import fs from "node:fs";
import path from "node:path";
import type { AppState } from "../../src/client/types.ts";
import { answerFetch } from "./fetch-guard.ts";
import { airport } from "./page-data.ts";

export const PACKAGE_VERSION: string = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "..", "..", "package.json"), "utf8")).version;

export interface StatusBody {
  ok: true;
  app: "msfs-career-map";
  version: string;
  pid: number;
  dataFolder: string;
  logbookId: string | null;
  sim: "link" | "fake" | "off";
  startup: "opening" | "bringing-in" | "backing-up" | "upgrading" | "done";
  airportData: { state: string; list?: string; rows?: number; total?: number; error?: string };
  ready: boolean;
  airports: number | null;
  runways: number | null;
}

export function statusBody(over: Partial<StatusBody> = {}): StatusBody {
  return {
    ok: true,
    app: "msfs-career-map",
    version: PACKAGE_VERSION,
    pid: 4242,
    dataFolder: "C:\\Users\\pilot\\AppData\\Local\\MSFS Career Map",
    logbookId: "a1b2c3d4e5f60718",
    sim: "link",
    startup: "done",
    airportData: { state: "done" },
    ready: true,
    airports: 72609,
    runways: 48291,
    ...over,
  };
}

export interface OfferBody {
  hops: number;
  aircraft: number;
  offers: (
    | { kind: "folder"; folder: string; hops: number; newestHop: string | null }
    | { kind: "backup"; file: string; time: string; hops: number; newestHop: string | null }
  )[];
  lastAttempt: { outcome: "brought-in" | "not-brought-in"; reason?: string; at: string } | null;
}

/**
 * What the server answers, changeable as the test goes. `state` and `status` may be a body, an
 * HTTP status to answer with an error (503 answers `{error: "MSFS Career Map is starting (<step>)"}`),
 * "down" for a request that fails outright, or (for `state`) a function whose promise gives the body. Every call is counted by path.
 */
export function fakeServer(init: { state: AppState; status?: StatusBody; offer?: OfferBody }) {
  const server = {
    state: init.state as AppState | number | "down" | (() => Promise<AppState>),
    status: (init.status ?? statusBody()) as StatusBody | number | "down",
    offer: (init.offer ?? { hops: init.state.hops.length, aircraft: init.state.aircraft.length, offers: [], lastAttempt: null }) as OfferBody,
    calls: new Map<string, number>(),
    /** Bodies of the non-GET requests, in order: "METHOD path body". */
    changes: [] as string[],
  };
  const count = (p: string) => server.calls.set(p, (server.calls.get(p) ?? 0) + 1);
  const answer = async (value: unknown) => {
    if (typeof value === "function") return Response.json(await (value as () => Promise<unknown>)());
    if (value === "down") throw new TypeError("Failed to fetch");
    if (typeof value === "number") {
      const step = typeof server.status === "object" ? server.status.startup : "opening";
      return Response.json({ error: value === 503 ? `MSFS Career Map is starting (${step})` : "failed" }, { status: value });
    }
    return Response.json(value);
  };
  answerFetch("/api/state", () => (count("/api/state"), answer(server.state)));
  answerFetch("/api/status", () => (count("/api/status"), answer(server.status)));
  answerFetch("/api/logbook/offer", () => (count("/api/logbook/offer"), Response.json(server.offer)));
  answerFetch("/api/settings", () => Response.json({ simbrief_username: null }));
  answerFetch("/api/simbrief/aircraft", () => Response.json({ types: [], source: "test", fetched_at: null }));
  answerFetch("/api/aircraft-types", () => Response.json({ snapshot: "2026-10-25", types: [] }));
  answerFetch(/\/api\/airports\/[A-Z0-9]+$/, (url) => Response.json(airport(url.pathname.split("/").pop()!)));
  answerFetch(/\/api\/metars\?/, () => Response.json({ metars: {}, fetched_at: "2026-10-09T14:00:00.000Z" }));
  return {
    server,
    calls: (p: string) => server.calls.get(p) ?? 0,
  };
}

/** Records a non-GET request the page makes, answering it with `reply`. */
export function answerChange(server: { changes: string[] }, match: string | RegExp, reply: (body: unknown) => Response | Promise<Response>) {
  answerFetch(match, async (url, init) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    server.changes.push(`${init?.method ?? "GET"} ${url.pathname}${body !== undefined ? ` ${JSON.stringify(body)}` : ""}`);
    return reply(body);
  });
}
