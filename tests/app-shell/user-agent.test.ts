/**
 * One User-Agent on every request the server makes to an outside service (APP-API-005): OurAirports,
 * aviationweather.gov (METARs and hazards), Wikipedia, Open-Meteo and SimBrief (its aircraft list and
 * the OFP). Each request is answered here with an error; only the header it carried matters.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AIRPORTS_URL, downloadList } from "../../src/server/airport-data.ts";
import { findAirport, latestMetars, wikiSummary } from "../../src/server/airports.ts";
import { currentHazards } from "../../src/server/hazards.ts";
import { fetchLatestOfp } from "../../src/server/ofp.ts";
import { simbriefAircraftTypes } from "../../src/server/simbrief.ts";
import { elevationsFt } from "../../src/server/terrain.ts";
import { USER_AGENT, VERSION } from "../../src/server/version.ts";
import { answerFetch } from "../support/fetch-guard.ts";
import { REPO } from "../support/server-process.ts";
import { emptyFolder, userAgentOf } from "../support/airport-lists.ts";

/** Answers every request matching `match` with 503, recording the user-agent of each. */
function record(match: RegExp | string): (string | null)[] {
  const agents: (string | null)[] = [];
  answerFetch(match, (_u, init) => {
    agents.push(userAgentOf(init));
    return new Response("{}", { status: 503, statusText: "Service Unavailable" });
  });
  return agents;
}

describe("the User-Agent (APP-API-005)", () => {
  // @spec APP-API-005
  it("names the app, its version from package.json and the project's address, and no person", () => {
    const version = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8")).version;
    expect(VERSION).toBe(version);
    expect(USER_AGENT).toBe(`MSFSCareerMap/${version} (+https://github.com/SharpWave/msfs-career-map)`);
    expect(USER_AGENT).not.toMatch(/@/);
  });

  const cases: [string, RegExp | string, () => Promise<unknown>][] = [
    ["OurAirports", AIRPORTS_URL, () => downloadList(AIRPORTS_URL, path.join(emptyFolder(), "airports.csv.partial"))],
    ["aviationweather.gov METARs", /^https:\/\/aviationweather\.gov\/api\/data\/metar\?/, () => latestMetars(["KZZZ"])],
    ["aviationweather.gov hazards", /^https:\/\/aviationweather\.gov\/api\/data\/(?!metar)/, () => currentHazards()],
    ["Wikipedia", /^https:\/\/en\.wikipedia\.org\/api\/rest_v1\//, () => wikiSummary(findAirport("KBOS")!)],
    ["Open-Meteo", /open-meteo\.com/, () => elevationsFt([[12.3456, 65.4321]])],
    ["SimBrief's aircraft list", /^https:\/\/www\.simbrief\.com\/api\/inputs\.list\.json/, () => simbriefAircraftTypes()],
    ["SimBrief's OFP", /^https:\/\/www\.simbrief\.com\/api\/xml\.fetcher\.php/, () => fetchLatestOfp("someone")],
  ];

  for (const [name, match, call] of cases) {
    // @spec APP-API-005
    it(`sends it to ${name}`, async () => {
      const agents = record(match);
      await call().catch(() => {});
      expect(agents.length, `no request reached ${name}`).toBeGreaterThan(0);
      expect(new Set(agents)).toEqual(new Set([USER_AGENT]));
    });
  }
});
