import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, inject, it, vi } from "vitest";
import { checkOwnDatabase, fixtureCounts, removeLeftovers, TEST_FOLDER_PREFIX } from "../support/run-folder.ts";
import { answerFetch, takeRefused } from "../support/fetch-guard.ts";
import { E2E_API_PORT, E2E_PAGE_PORT } from "../support/ports.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const isInside = (child: string, parent: string) => {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

describe("npm test data folders", () => {
  // @spec APP-RUN-011
  it("gives this test file a data folder of its own in the run's temp folder, with the fixture lists loaded", async () => {
    const runDir = inject("runDir");
    const dbPath = process.env.CAREER_DB!;
    const fileDir = path.dirname(dbPath);
    expect(isInside(runDir, os.tmpdir())).toBe(true);
    expect(path.basename(runDir).startsWith(TEST_FOLDER_PREFIX)).toBe(true);
    expect(path.dirname(fileDir)).toBe(runDir);
    expect(fs.existsSync(path.join(fileDir, "airports.csv"))).toBe(true);
    expect(fs.existsSync(path.join(fileDir, "runways.csv"))).toBe(true);

    const { db, DB_PATH } = await import("../../src/server/db.ts");
    expect(DB_PATH).toBe(dbPath);
    const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
    expect(count("airports")).toBe(fixtureCounts().airports);
    expect(count("runways")).toBe(fixtureCounts().runways);
    expect(count("aircraft")).toBe(0);
  });

  // @spec APP-RUN-013
  it("refuses a database outside the test file's own data folder", () => {
    const fileDir = path.join(os.tmpdir(), `${TEST_FOLDER_PREFIX}x`, "file-1");
    expect(() => checkOwnDatabase(path.join(fileDir, "career.db"), fileDir)).not.toThrow();
    expect(() => checkOwnDatabase(undefined, fileDir)).toThrow();
    expect(() => checkOwnDatabase("", fileDir)).toThrow();
    expect(() => checkOwnDatabase(path.join(REPO, "data", "career.db"), fileDir)).toThrow();
    expect(() => checkOwnDatabase(path.join(fileDir, "..", "career.db"), fileDir)).toThrow();
    expect(() => checkOwnDatabase(path.join(fileDir, "..", "file-2", "career.db"), fileDir)).toThrow();
    expect(() => checkOwnDatabase(path.join(fileDir, "sub", "career.db"), fileDir)).toThrow();
  });

  // @spec APP-RUN-015
  it("deletes leftover test folders more than a day old and nothing else", () => {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "leftover-sandbox-"));
    try {
      const now = Date.now();
      const make = (name: string, ageMs: number) => {
        const dir = path.join(sandbox, name);
        fs.mkdirSync(path.join(dir, "images"), { recursive: true });
        fs.writeFileSync(path.join(dir, "career.db"), "");
        const t = new Date(now - ageMs);
        fs.utimesSync(dir, t, t);
        return dir;
      };
      const old = make(`${TEST_FOLDER_PREFIX}old`, 25 * 3600_000);
      const fresh = make(`${TEST_FOLDER_PREFIX}fresh`, 3600_000);
      const other = make("someone-elses-folder", 48 * 3600_000);

      const removed = removeLeftovers(sandbox, now);
      expect(removed).toEqual([old]);
      expect(fs.existsSync(old)).toBe(false);
      expect(fs.existsSync(fresh)).toBe(true);
      expect(fs.existsSync(other)).toBe(true);
    } finally {
      fs.rmSync(sandbox, { recursive: true, force: true });
    }
  });
});

describe("outside requests from Vitest tests", () => {
  // @spec APP-RUN-014
  it("refuses a request to the internet that the test has not answered", async () => {
    await expect(fetch("https://example.com/anything")).rejects.toThrow(/refused/);
    expect(takeRefused()).toEqual(["https://example.com/anything"]);
  });

  // @spec APP-RUN-014
  it("refuses a request to another local port, where the user's own server may be running", async () => {
    await expect(fetch("http://localhost:3080/api/status")).rejects.toThrow(/refused/);
    await expect(fetch("http://127.0.0.1:3080/api/state")).rejects.toThrow(/refused/);
    expect(takeRefused()).toHaveLength(2);
  });

  // @spec APP-RUN-014
  it("returns the answer the test supplied", async () => {
    answerFetch(/aviationweather\.gov\/api\/data\/metar/, () => Response.json([{ icaoId: "KBOS", rawOb: "KBOS 091554Z 27010KT 10SM FEW050 18/08 A3002" }]));
    const res = await fetch("https://aviationweather.gov/api/data/metar?ids=KBOS&format=json");
    expect(await res.json()).toEqual([{ icaoId: "KBOS", rawOb: "KBOS 091554Z 27010KT 10SM FEW050 18/08 A3002" }]);
    expect(takeRefused()).toEqual([]);
  });

  // @spec APP-RUN-014
  it("forgets a supplied answer after the test that supplied it", async () => {
    await expect(fetch("https://aviationweather.gov/api/data/metar?ids=KBOS&format=json")).rejects.toThrow(/refused/);
    expect(takeRefused()).toHaveLength(1);
  });
});

describe("data locations", () => {
  // @spec APP-DATA-001, APP-DATA-002
  it("keeps icons and airport lists in the folder of the database in use", async () => {
    const { dataLocations } = await import("../../src/server/locations.ts");
    const def = dataLocations(undefined);
    expect(def.dbPath).toBe(path.join(REPO, "data", "career.db"));
    expect(def.imagesDir).toBe(path.join(REPO, "data", "images"));
    expect(def.airportsCsv).toBe(path.join(REPO, "data", "airports.csv"));
    expect(def.runwaysCsv).toBe(path.join(REPO, "data", "runways.csv"));

    const copy = path.join(os.tmpdir(), "some-copy", "test.db");
    const loc = dataLocations(copy);
    expect(loc.dbPath).toBe(copy);
    expect(loc.imagesDir).toBe(path.join(os.tmpdir(), "some-copy", "images"));
    expect(loc.airportsCsv).toBe(path.join(os.tmpdir(), "some-copy", "airports.csv"));
    expect(loc.runwaysCsv).toBe(path.join(os.tmpdir(), "some-copy", "runways.csv"));
  });

  // @spec APP-DATA-002
  it("points the open database's icons and lists at this test file's folder", async () => {
    const { DB_PATH, IMAGES_DIR, AIRPORTS_CSV, RUNWAYS_CSV } = await import("../../src/server/db.ts");
    const dir = path.dirname(DB_PATH);
    expect(IMAGES_DIR).toBe(path.join(dir, "images"));
    expect(AIRPORTS_CSV).toBe(path.join(dir, "airports.csv"));
    expect(RUNWAYS_CSV).toBe(path.join(dir, "runways.csv"));
  });
});

describe("dev and browser-test servers", () => {
  const savedPort = process.env.PORT;
  afterEach(() => {
    if (savedPort === undefined) delete process.env.PORT;
    else process.env.PORT = savedPort;
    vi.resetModules();
  });

  // @spec APP-RUN-001
  it("has the page's dev server pass /api and /images to the server on PORT, 3080 by default", async () => {
    delete process.env.PORT;
    vi.resetModules();
    const byDefault = (await import("../../vite.config.ts")).default as { server: { proxy: Record<string, unknown> } };
    expect(byDefault.server.proxy).toEqual({ "/api/": "http://localhost:3080", "/images/": "http://localhost:3080" });

    process.env.PORT = "4321";
    vi.resetModules();
    const moved = (await import("../../vite.config.ts")).default as { server: { proxy: Record<string, unknown> } };
    expect(moved.server.proxy).toEqual({ "/api/": "http://localhost:4321", "/images/": "http://localhost:4321" });
  });

  // @spec APP-RUN-001
  it("keeps the page's own modules, such as /api.ts, on the dev server", async () => {
    const config = (await import("../../vite.config.ts")).default as { server: { proxy: Record<string, unknown> } };
    // Vite passes on every path that starts with a proxy key.
    for (const own of ["/api.ts", "/images.ts", "/App.tsx"]) {
      expect(Object.keys(config.server.proxy).filter((k) => own.startsWith(k)), own).toEqual([]);
    }
  });

  // @spec APP-RUN-012, APP-RUN-016
  it("starts the browser-test servers on their own ports, never reusing a server already there", async () => {
    const config = (await import("../../playwright.config.ts")).default;
    expect(E2E_API_PORT).toBe(3180);
    expect(E2E_PAGE_PORT).toBe(5183);
    expect(config.workers).toBe(1);
    expect(config.projects?.map((p) => p.name)).toEqual(["chromium"]);
    const servers = config.webServer as { command: string; url: string; env?: Record<string, string>; reuseExistingServer?: boolean }[];
    expect(servers).toHaveLength(2);
    for (const s of servers) expect(s.reuseExistingServer).toBe(false);
    const [app, page] = servers;
    expect(app.url).toBe(`http://localhost:${E2E_API_PORT}/api/status`);
    expect(app.env).toMatchObject({ PORT: String(E2E_API_PORT), TRACKER_FAKE: "1" });
    expect(page.command).toContain(`--port ${E2E_PAGE_PORT}`);
    expect(page.command).toContain("--strictPort");
    expect(page.env).toMatchObject({ PORT: String(E2E_API_PORT) });
  });
});
