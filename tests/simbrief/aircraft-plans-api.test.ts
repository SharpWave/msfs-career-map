/**
 * The digest of an aircraft's SimBrief plans (`GET /api/aircraft/:id/plans`, SB-HOP-006): for each of
 * its hops with a plan, in tour order, the plan's id, time en route, fuel unit and planned burn, and
 * PDF address.
 */
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { answerFetch } from "../support/fetch-guard.ts";
import { startTestServer, type TestServer } from "../support/test-server.ts";

// A tripwire: nothing in this file may connect to the sim.
const simLink = vi.hoisted(() => ({ startSimLink: vi.fn() }));
vi.mock("../../src/server/simconnect.ts", () => simLink);

const OFP = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, "..", "fixtures", "simbrief-e2e-ofp.json"), "utf8")) as {
  params: Record<string, unknown>;
  times: Record<string, unknown>;
  fuel: Record<string, unknown>;
  files: { directory: string; pdf: { link: string } };
};

interface Entry {
  hop_id: number;
  id: number;
  ete_min: number | null;
  fuel: { units: string | null; burn: number | null };
  pdf_url: string | null;
}

describe("GET /api/aircraft/:id/plans", () => {
  let server: TestServer;
  let aircraftId: number;
  let otherId: number;
  const hops: number[] = [];

  const send = (method: string, p: string, body?: unknown) =>
    fetch(`${server.base}${p}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const plans = async (id: number) => (await (await fetch(`${server.base}/api/aircraft/${id}/plans`)).json()) as Entry[];
  /** The pilot's latest plan, as SimBrief answers it now. */
  let latest: unknown = OFP;
  beforeEach(() => {
    answerFetch(/simbrief\.com\/api\/xml\.fetcher\.php/, () => Response.json(latest));
  });
  /** Attach "the pilot's latest plan" to a hop, SimBrief answering with `ofp`. */
  const attach = async (hopId: number, ofp: unknown) => {
    latest = ofp;
    const res = await send("POST", `/api/hops/${hopId}/briefing`);
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: number }).id;
  };

  beforeAll(async () => {
    server = await startTestServer();
    expect((await send("PUT", "/api/settings", { simbrief_username: "digest-pilot" })).status).toBe(200);
    aircraftId = ((await (await send("POST", "/api/aircraft", { name: "Digest", livery: "N1" })).json()) as { id: number }).id;
    otherId = ((await (await send("POST", "/api/aircraft", { name: "Digest other", livery: "N2" })).json()) as { id: number }).id;
    for (const [origin, dest] of [
      ["KBOS", "KPVD"],
      ["KPVD", "KHYA"],
      ["KHYA", "KACK"],
    ]) {
      const res = await send("POST", "/api/hops", { aircraft_id: aircraftId, origin, dest });
      expect(res.status).toBe(201);
      hops.push(((await res.json()) as { id: number }).id);
    }
  });
  afterAll(async () => {
    await server.close();
  });

  // @spec SB-HOP-006
  it("answers an empty list for an aircraft whose hops have no plan", async () => {
    expect(await plans(aircraftId)).toEqual([]);
    expect(await plans(otherId)).toEqual([]);
  });

  // @spec SB-HOP-006
  it("gives each hop with a plan its plan's id, time en route, fuel unit, planned burn and PDF address, in tour order", async () => {
    // Attached last hop first, so the order answered is the tour's and not the plans'.
    const kgs = { ...OFP, params: { ...OFP.params, units: "kgs" }, times: { ...OFP.times, est_time_enroute: "6720" }, fuel: { ...OFP.fuel, enroute_burn: "520" } };
    const lbs = { ...OFP, fuel: { ...OFP.fuel, enroute_burn: "1150" } };
    const third = await attach(hops[2], kgs);
    const first = await attach(hops[0], lbs);

    const pdf = OFP.files.directory + OFP.files.pdf.link;
    expect(await plans(aircraftId)).toEqual([
      { hop_id: hops[0], id: first, ete_min: 22, fuel: { units: "lbs", burn: 1150 }, pdf_url: pdf },
      { hop_id: hops[2], id: third, ete_min: 112, fuel: { units: "kgs", burn: 520 }, pdf_url: pdf },
    ]);
    expect(await plans(otherId)).toEqual([]);
  });

  // @spec SB-HOP-006
  it("gives null where the plan's summary has no figure", async () => {
    const bare = { ...OFP, times: {}, fuel: {}, files: {} };
    const id = await attach(hops[1], bare);
    const entry = (await plans(aircraftId)).find((e) => e.hop_id === hops[1]);
    expect(entry).toEqual({ hop_id: hops[1], id, ete_min: null, fuel: { units: "lbs", burn: null }, pdf_url: null });
  });

  // @spec SB-HOP-006
  it("has no entry for a hop whose plan was removed", async () => {
    expect((await send("DELETE", `/api/hops/${hops[1]}/briefing`)).status).toBe(204);
    expect((await plans(aircraftId)).map((e) => e.hop_id)).toEqual([hops[0], hops[2]]);
  });

  // @spec SB-HOP-006
  it("answers 404 when there is no such aircraft", async () => {
    const res = await fetch(`${server.base}/api/aircraft/999999/plans`);
    expect(res.status).toBe(404);
  });
});
