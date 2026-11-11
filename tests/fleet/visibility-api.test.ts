/**
 * Hiding or showing many fleet aircraft in one request (`PUT /api/aircraft/visibility`,
 * FLEET-LOOK-013): every aircraft, or every aircraft but one that keeps its flag.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { startTestServer, type TestServer } from "../support/test-server.ts";

// A tripwire: nothing in this file may connect to the sim.
const simLink = vi.hoisted(() => ({ startSimLink: vi.fn() }));
vi.mock("../../src/server/simconnect.ts", () => simLink);

interface Row {
  id: number;
  name: string;
  visible: number;
}

describe("PUT /api/aircraft/visibility", () => {
  let server: TestServer;
  let ids: number[];

  const send = (method: string, path: string, body?: unknown) =>
    fetch(`${server.base}${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const fleet = async () => (await (await fetch(`${server.base}/api/aircraft`)).json()) as Row[];
  const flags = async () => Object.fromEntries((await fleet()).map((a) => [a.id, a.visible]));
  const setAll = (visible: boolean, except?: unknown) => send("PUT", "/api/aircraft/visibility", except === undefined ? { visible } : { visible, except });

  beforeAll(async () => {
    server = await startTestServer();
    ids = [];
    for (const name of ["Vis C", "Vis A", "Vis B"]) {
      const res = await send("POST", "/api/aircraft", { name, livery: "N1" });
      expect(res.status).toBe(201);
      ids.push(((await res.json()) as Row).id);
    }
  });
  afterAll(async () => {
    await server.close();
  });
  beforeEach(async () => {
    for (const id of ids) await send("PUT", `/api/aircraft/${id}`, { visible: true });
  });

  // @spec FLEET-LOOK-013
  it("hides every aircraft but the one named, which keeps its flag", async () => {
    const res = await setAll(false, ids[0]);
    expect(res.status).toBe(200);
    expect(await flags()).toEqual({ [ids[0]]: 1, [ids[1]]: 0, [ids[2]]: 0 });
  });

  // @spec FLEET-LOOK-013
  it("shows every aircraft but the one named, leaving a hidden one hidden", async () => {
    await setAll(false);
    const res = await setAll(true, ids[1]);
    expect(res.status).toBe(200);
    expect(await flags()).toEqual({ [ids[0]]: 1, [ids[1]]: 0, [ids[2]]: 1 });
  });

  // @spec FLEET-LOOK-013
  it("sets every aircraft when none is named", async () => {
    expect((await setAll(false)).status).toBe(200);
    expect(await flags()).toEqual({ [ids[0]]: 0, [ids[1]]: 0, [ids[2]]: 0 });
    expect((await setAll(true)).status).toBe(200);
    expect(await flags()).toEqual({ [ids[0]]: 1, [ids[1]]: 1, [ids[2]]: 1 });
  });

  // @spec FLEET-LOOK-013
  it("answers every fleet aircraft as GET /api/aircraft does", async () => {
    // ids[0] is "Vis C", the last by name.
    const res = await setAll(false, ids[0]);
    const body = (await res.json()) as Row[];
    expect(body).toEqual(await fleet());
    expect(body.map((a) => a.name)).toEqual(["Vis A", "Vis B", "Vis C"]);
    expect(body.map((a) => a.visible)).toEqual([0, 0, 1]);
  });

  // @spec FLEET-LOOK-013
  it("answers 400 and changes nothing unless visible is true or false", async () => {
    await setAll(false, ids[0]);
    const before = await flags();
    for (const body of [{}, { visible: "yes" }, { visible: 1 }, { visible: null }, { except: ids[0] }]) {
      const res = await send("PUT", "/api/aircraft/visibility", body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(((await res.json()) as { error: string }).error, JSON.stringify(body)).toMatch(/visible/);
    }
    expect(await flags()).toEqual(before);
  });

  // @spec FLEET-LOOK-013
  it("answers 400 and changes nothing when except is not an aircraft id", async () => {
    const before = await flags();
    for (const except of ["abc", 1.5, -1, 0, true, [ids[0]]]) {
      const res = await setAll(false, except);
      expect(res.status, JSON.stringify(except)).toBe(400);
      expect(((await res.json()) as { error: string }).error, JSON.stringify(except)).toMatch(/except/);
    }
    expect(await flags()).toEqual(before);
  });

  // @spec FLEET-LOOK-013
  it("answers 404 and changes nothing when except names no fleet aircraft", async () => {
    const before = await flags();
    const res = await setAll(false, 999999);
    expect(res.status).toBe(404);
    expect(await flags()).toEqual(before);
  });

  // @spec FLEET-LOOK-013, FLEET-REC-014
  it("leaves an aircraft's own update route as it was", async () => {
    const res = await send("PUT", `/api/aircraft/${ids[0]}`, { visible: false });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Row).visible).toBe(0);
    expect(await flags()).toEqual({ [ids[0]]: 0, [ids[1]]: 1, [ids[2]]: 1 });
  });
});
