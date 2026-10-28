/**
 * A fleet aircraft's airline (the server's aircraft routes): an optional ICAO airline designator, stored
 * trimmed and upper-cased, a blank one as null, and anything but three letters refused with 400
 * (FLEET-REC-001, FLEET-REC-019); an update that omits it keeps it (FLEET-REC-014).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startTestServer, type TestServer } from "../support/test-server.ts";

// A tripwire: nothing in this file may connect to the sim.
const simLink = vi.hoisted(() => ({ startSimLink: vi.fn() }));
vi.mock("../../src/server/simconnect.ts", () => simLink);

const MESSAGE = "airline must be a three-letter ICAO airline code";

describe("a fleet aircraft's airline", () => {
  let server: TestServer;
  let n = 0;
  beforeAll(async () => {
    server = await startTestServer();
  });
  afterAll(async () => {
    await server.close();
  });

  const send = (method: "POST" | "PUT", path: string, body: Record<string, unknown>) =>
    fetch(`${server.base}${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const create = (airline: unknown) => send("POST", "/api/aircraft", { name: `Airline test ${++n}`, livery: "N1", airline });

  // @spec FLEET-REC-001, FLEET-REC-019
  it("is stored trimmed and upper-cased", async () => {
    const res = await create(" jbu ");
    expect(res.status).toBe(201);
    const a = (await res.json()) as { id: number; airline: string | null };
    expect(a.airline).toBe("JBU");
    const listed = ((await (await fetch(`${server.base}/api/aircraft`)).json()) as { id: number; airline: string | null }[]).find((x) => x.id === a.id);
    expect(listed?.airline).toBe("JBU");
  });

  // @spec FLEET-REC-019
  it("is stored as null when blank or not given", async () => {
    for (const airline of ["", "   ", null, undefined]) {
      const res = await create(airline);
      expect(res.status, String(airline)).toBe(201);
      expect(((await res.json()) as { airline: string | null }).airline, String(airline)).toBeNull();
    }
  });

  // @spec FLEET-REC-019
  it("is refused with 400 unless it is three letters", async () => {
    for (const airline of ["JB", "JBUX", "JB1", "J U", "jetblue", "B6", "ÅBC"]) {
      const res = await create(airline);
      expect(res.status, airline).toBe(400);
      expect(((await res.json()) as { error: string }).error, airline).toBe(MESSAGE);
    }
  });

  // @spec FLEET-REC-019, FLEET-REC-014
  it("is changed or cleared by an update, and kept by one that omits it", async () => {
    const a = (await (await create("BAW")).json()) as { id: number };
    const put = (body: Record<string, unknown>) => send("PUT", `/api/aircraft/${a.id}`, { name: "Kept", ...body });
    expect(((await (await put({ notes: "x" })).json()) as { airline: string | null }).airline).toBe("BAW");
    expect(((await (await put({ airline: "vir" })).json()) as { airline: string | null }).airline).toBe("VIR");
    const bad = await put({ airline: "VI" });
    expect(bad.status).toBe(400);
    expect(((await (await put({ airline: "" })).json()) as { airline: string | null }).airline).toBeNull();
  });
});
