/**
 * The run commands and the test harness: each test file's own data folder, the guard against
 * outside requests, where the data lives, the scripts in package.json, what git keeps out, the
 * page's dev server and the browser-test servers, the browser tests' readiness check, and the guard
 * that keeps every server a test starts off the pilot's logbook, the sim and the ports a real
 * server uses.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, describe, expect, inject, it, vi } from "vitest";
import checkTestServer, { waitForTestServer } from "../e2e/global-setup.ts";
import { checkOwnDatabase, fixtureCounts, removeLeftovers, TEST_FOLDER_PREFIX } from "../support/run-folder.ts";
import { allowOrigin, answerFetch, takeRefused } from "../support/fetch-guard.ts";
import { E2E_API_PORT, E2E_PAGE_PORT } from "../support/ports.ts";
import {
  checkTestServerArgs,
  killAllServers,
  killTestServers,
  launchServer,
  REPO,
  RESERVED_PORTS,
  silentPort,
  type ServerEntry,
} from "../support/server-process.ts";

afterEach(killTestServers);
afterAll(killAllServers);

const PROCESS = { timeout: 30_000 };
const isInside = (child: string, parent: string) => {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};
const readPackage = () =>
  JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
    engines?: Record<string, string>;
  };
type ViteConfig = { server: { host?: string; port?: number; proxy: Record<string, unknown> } };
type WebServer = { command: string; url: string; env?: Record<string, string>; reuseExistingServer?: boolean };

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

describe("run commands in package.json", () => {
  // @spec APP-RUN-001
  it("npm run dev starts the server from source, restarting on change and with no --sim, beside the page's dev server", () => {
    const { scripts } = readPackage();
    expect(scripts.dev).toBe('concurrently -n server,client -c blue,green "npm run dev:server" "npm run dev:client"');
    expect(scripts["dev:server"]).toBe("tsx watch --no-warnings=ExperimentalWarning src/server/index.ts");
    expect(scripts["dev:client"]).toBe("vite");
    for (const name of ["dev", "dev:server", "dev:client"]) expect(scripts[name], name).not.toContain("--sim");
  });

  // @spec APP-RUN-019
  it("npm run dev:sim runs what npm run dev does, its server started with --sim=link", () => {
    const { scripts } = readPackage();
    expect(scripts["dev:sim"]).toBe(
      'concurrently -n server,client -c blue,green "npm run dev:server -- --sim=link" "npm run dev:client"',
    );
    expect(scripts["dev:sim"]).toBe(scripts.dev.replace('"npm run dev:server"', '"npm run dev:server -- --sim=link"'));
  });

  // @spec APP-RUN-002
  it("npm start runs the server from source with no --sim of its own, so `npm start -- --sim=link` adds it", () => {
    expect(readPackage().scripts.start).toBe("node --no-warnings=ExperimentalWarning --import tsx src/server/index.ts");
  });

  // @spec APP-RUN-004
  it("states in engines that running from source needs Node 22.16 or later", () => {
    expect(readPackage().engines).toEqual({ node: ">=22.16" });
  });
});

describe("what git keeps out", () => {
  /** `git check-ignore`'s status for a path: 0 ignored, 1 not ignored. The path need not exist. */
  const ignoreStatus = (p: string) =>
    spawnSync("git", ["check-ignore", "--no-index", "-q", p], { cwd: REPO, windowsHide: true }).status;

  // @spec APP-RUN-020
  it("keeps out everything a copy run from source keeps in data/", () => {
    const kept = [
      "data/career.db",
      "data/career.db-wal",
      "data/career.db-shm",
      "data/career.db.lock",
      "data/career.db.incoming",
      "data/career.db.incoming.json",
      "data/images/a.png",
      "data/airports.csv",
      "data/airports.csv.downloaded",
      "data/runways.csv.downloaded",
      "data/backups/career-20261024T120000Z-manual-0123456789abcdef.db",
      "data/career.before-import-20261024T120000Z.db",
      "data/images.before-restore-20261024T120000Z/a.png",
    ];
    expect(Object.fromEntries(kept.map((p) => [p, ignoreStatus(p)]))).toEqual(Object.fromEntries(kept.map((p) => [p, 0])));
  });

  // @spec APP-RUN-020
  it("keeps the code in git, and keeps out only the repository's own data/, with one line", () => {
    expect(ignoreStatus("src/server/db.ts")).toBe(1);
    // A folder named data anywhere else is the code's or the tests'.
    expect(ignoreStatus("tests/fixtures/data/x")).toBe(1);
    expect(ignoreStatus("src/data/x.ts")).toBe(1);
    const lines = fs.readFileSync(path.join(REPO, ".gitignore"), "utf8").split(/\r?\n/).map((l) => l.trim());
    expect(lines.filter((l) => l.includes("data"))).toEqual(["/data/"]);
  });
});

describe("what the tests give the servers and app modules they start", () => {
  const runDir = inject("runDir");

  // @spec APP-RUN-021, APP-SRV-023
  it("gives this file's app modules a data folder and backups folder inside the run's temp folder, with sim off", async () => {
    const { currentInputs } = await import("../../src/server/inputs.ts");
    const inputs = currentInputs();
    const careerDb = path.resolve(process.env.CAREER_DB!);
    expect(inputs.form).toBe("source");
    expect(inputs.dbPath).toBe(careerDb);
    expect(inputs.dataFolder).toBe(path.dirname(careerDb));
    expect(isInside(inputs.dataFolder, runDir)).toBe(true);
    expect(inputs.backups).toEqual({ kind: "folder", folder: path.join(inputs.dataFolder, "backups") });
    expect(isInside(path.join(inputs.dataFolder, "backups"), runDir)).toBe(true);
    expect(inputs.sim).toBe("off");
    expect(inputs.offer).toBeNull();
  });

  // @spec APP-SRV-023, APP-RUN-021
  it("has the shared setup prepare this file's airport data with downloads off", async () => {
    const setup = fs.readFileSync(path.join(REPO, "tests", "support", "setup-node.ts"), "utf8");
    expect(setup).toContain("await ensureReferenceData({ downloads: false });");
    expect(setup).not.toMatch(/ensureReferenceData\(\s*\)/);
    const { serverStatus } = await import("../../src/server/status.ts");
    expect(serverStatus()).toMatchObject({ startup: "done", airportData: { state: "done" }, ready: true });
    expect(takeRefused()).toEqual([]);
  });

  // @spec APP-RUN-021, APP-RUN-012
  it("starts the browser-test app server on the fake feed with downloads off, naming no folder of its own", async () => {
    const config = (await import("../../playwright.config.ts")).default;
    const [app] = config.webServer as WebServer[];
    const args = app.command.split(/\s+/);
    expect(args).toContain(`--port=${E2E_API_PORT}`);
    expect(args).toContain("--sim=fake");
    expect(args).toContain("--airport-downloads=off");
    expect(args.filter((a) => /^--(data|backups|program|offer)/.test(a))).toEqual([]);
    expect(args.filter((a) => a.startsWith("--sim") && a !== "--sim=fake")).toEqual([]);
    // No TRACKER_FAKE, CAREER_DB or PORT handed over: the arguments say it all.
    expect(app.env).toBeUndefined();
  });

  // @spec APP-RUN-021
  it("has the browser-test server refuse any folder argument and start only with its three arguments, on its own folder", () => {
    const text = fs.readFileSync(path.join(REPO, "tests", "support", "e2e-server.ts"), "utf8");
    expect(text).toContain('const REFUSED = ["--data", "--backups", "--program", "--offer"];');
    expect(text).toContain('const REQUIRED = [`--port=${E2E_API_PORT}`, "--sim=fake", "--airport-downloads=off"];');
    // The checks come first, then the run's own folder, and only then the server, on that folder.
    const refusal = text.indexOf("REFUSED.some((prefix) => arg.startsWith(prefix))");
    const missing = text.indexOf("if (!args.includes(required))");
    const folder = text.indexOf('makeDataFolder(makeRunFolder("e2e-"))');
    const start = text.indexOf('runServer("source", [...args, `--data=${dir}`], process.env)');
    for (const at of [refusal, missing, folder, start]) expect(at).toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(folder);
    expect(missing).toBeLessThan(folder);
    expect(folder).toBeLessThan(start);
    expect(text).toContain('await import("../../src/server/server.ts")');
    expect(text).not.toContain("src/server/index.ts");
    expect(text).toContain("removeLeftovers();");
    expect(text).toContain('installFetchGuard({ onRefused: (url) => console.log(`[e2e] refused outside request: ${url}`) });');
    // Behind the arguments: a canary CAREER_DB and no database outside the data folder, before the server loads.
    const canary = text.indexOf('process.env.CAREER_DB = path.join(path.dirname(dir), "canary", "career.db");');
    const guard = text.indexOf("guardDatabases(dir);");
    expect(canary).toBeGreaterThan(folder);
    expect(guard).toBeGreaterThan(folder);
    const load = text.indexOf('await import("../../src/server/server.ts")');
    expect(canary).toBeLessThan(load);
    expect(guard).toBeLessThan(load);
  });
});

describe("the launch guard: checkTestServerArgs", () => {
  const runDir = inject("runDir");
  const data = path.join(runDir, "data-guard");
  const program = path.join(runDir, "program-guard");
  const FORMS: ServerEntry[] = ["bundled", "source"];
  /** launchServer's default arguments for each form, on folders inside the run folder. */
  const DEFAULTS: Record<ServerEntry, string[]> = {
    bundled: [`--data=${data}`, `--program=${program}`, "--port=0", `--backups=${path.join(data, "backups")}`, "--sim=off", "--airport-downloads=off"],
    source: [`--data=${data}`, "--port=0", "--sim=off", "--airport-downloads=off"],
  };
  const nameOf = (arg: string) => arg.split("=")[0];
  /** The defaults with each of `args` in place of the default of its name, or added after them. */
  const withArgs = (entry: ServerEntry, ...args: string[]) => {
    const out = [...DEFAULTS[entry]];
    for (const a of args) {
      const i = out.findIndex((d) => nameOf(d) === nameOf(a));
      if (i >= 0) out[i] = a;
      else out.push(a);
    }
    return out;
  };
  /** The defaults with the argument `--<name>` left out. */
  const without = (entry: ServerEntry, name: string) => DEFAULTS[entry].filter((d) => nameOf(d) !== `--${name}`);
  type Env = Record<string, string | undefined>;
  const label = (entry: ServerEntry, args: readonly string[], env: Env) => `${entry}: ${args.join(" ")} env ${JSON.stringify(env)}`;
  const refuses = (entry: ServerEntry, args: readonly string[], env: Env = {}) =>
    expect(() => checkTestServerArgs(entry, args, env, runDir), label(entry, args, env)).toThrow(/^checkTestServerArgs: /);
  const passes = (entry: ServerEntry, args: readonly string[], env: Env = {}) =>
    expect(() => checkTestServerArgs(entry, args, env, runDir), label(entry, args, env)).not.toThrow();

  /** Folders outside the run folder: the pilot's logbook from source, the installed app's, and escapes. */
  const OUTSIDE = [
    path.join(REPO, "data"),
    path.join(os.homedir(), "AppData", "Local", "MSFS Career Map"),
    path.join(os.homedir(), "Documents", "MSFS Career Map", "Backups"),
    path.join(runDir, ".."),
    path.join(runDir, "..", "elsewhere"),
    `${runDir}-sibling`,
    path.join(runDir, "data-x", "..", "..", "escaped"),
    "data", // relative: resolved against the working folder, the repository
  ];
  const INSIDE = [path.join(runDir, "data-x"), path.join(runDir, "a", "b", "c"), path.join(runDir, "data-x", "..", "data-y")];

  // @spec APP-RUN-021
  it("passes launchServer's defaults of both forms, with the fake feed, the fresh-run flag and a logbook to offer inside the run folder", () => {
    for (const form of FORMS) {
      passes(form, DEFAULTS[form]);
      passes(form, withArgs(form, "--sim=fake"));
      passes(form, withArgs(form, "--fresh-run"));
      passes(form, withArgs(form, `--offer=${path.join(runDir, "offer", "career.db")}`));
    }
    // With --data and --port given, the source form's CAREER_DB and PORT do not count.
    passes("source", DEFAULTS.source, { CAREER_DB: path.join(REPO, "data", "career.db"), PORT: "3080", TRACKER_FAKE: "1" });
  });

  // @spec APP-RUN-021
  it("passes the bundled defaults with any one argument left out, since that server exits before it touches anything", () => {
    for (const name of ["data", "program", "port", "backups", "sim", "airport-downloads"]) {
      const args = without("bundled", name);
      expect(args, name).toHaveLength(DEFAULTS.bundled.length - 1);
      passes("bundled", args);
    }
  });

  // @spec APP-RUN-021
  it("refuses the sim link in either form, alone or given after another --sim", () => {
    for (const form of FORMS) {
      refuses(form, withArgs(form, "--sim=link"));
      refuses(form, [...DEFAULTS[form], "--sim=link"]);
    }
  });

  // @spec APP-RUN-021
  it("refuses airport downloads: --airport-downloads=on in either form, and the source defaults without --airport-downloads", () => {
    for (const form of FORMS) {
      refuses(form, withArgs(form, "--airport-downloads=on"));
      refuses(form, [...DEFAULTS[form], "--airport-downloads=on"]);
    }
    refuses("source", without("source", "airport-downloads"));
    refuses("source", without("source", "airport-downloads"), { CAREER_DB: path.join(data, "career.db"), PORT: "45123" });
    passes("bundled", without("bundled", "airport-downloads"));
  });

  // @spec APP-RUN-021
  it("refuses --backups-documents in either form, with a value or without", () => {
    for (const form of FORMS) {
      refuses(form, [...DEFAULTS[form], "--backups-documents=MSFS Career Map\\Backups"]);
      refuses(form, [...DEFAULTS[form], "--backups-documents"]);
    }
    refuses("bundled", [...without("bundled", "backups"), "--backups-documents=MSFS Career Map\\Backups"]);
  });

  // @spec APP-RUN-021
  it("refuses each reserved port in either form, the installed app's 3380 among them", () => {
    expect(RESERVED_PORTS).toEqual([3080, 3180, 3280, 3380, 5173, 5183]);
    for (const form of FORMS) {
      for (const port of RESERVED_PORTS) {
        refuses(form, withArgs(form, `--port=${port}`));
        refuses(form, [...DEFAULTS[form], `--port=${port}`]);
      }
      passes(form, withArgs(form, "--port=45123"));
    }
  });

  // @spec APP-RUN-021
  it("refuses the source defaults without --port while PORT is unset, empty or reserved; the bundled form ignores PORT", () => {
    const noPort = without("source", "port");
    refuses("source", noPort);
    refuses("source", noPort, { PORT: "" });
    for (const port of RESERVED_PORTS) refuses("source", noPort, { PORT: String(port) });
    passes("source", noPort, { PORT: "45123" });

    passes("bundled", without("bundled", "port"));
    passes("bundled", without("bundled", "port"), { PORT: "3080" });
  });

  // @spec APP-RUN-021
  it("refuses --data, --backups or --offer outside the run folder, in either form", () => {
    for (const form of FORMS) {
      for (const name of ["data", "backups", "offer"]) {
        for (const p of OUTSIDE) refuses(form, withArgs(form, `--${name}=${p}`));
        for (const p of INSIDE) passes(form, withArgs(form, `--${name}=${p}`));
        // A later one wins in the server, so a later one outside is refused too.
        refuses(form, [...withArgs(form, `--${name}=${INSIDE[0]}`), `--${name}=${OUTSIDE[0]}`]);
      }
    }
  });

  // @spec APP-RUN-021
  it.runIf(process.platform === "win32")("compares folders without regard to case on Windows", () => {
    for (const form of FORMS) {
      passes(form, withArgs(form, `--data=${path.join(runDir.toUpperCase(), "data-x")}`));
      passes(form, withArgs(form, `--data=${path.join(runDir.toLowerCase(), "data-x")}`));
      refuses(form, withArgs(form, `--data=${path.join(REPO.toUpperCase(), "DATA")}`));
    }
  });

  // @spec APP-RUN-021
  it("refuses the source form without --data unless CAREER_DB names a database inside the run folder; the bundled form ignores CAREER_DB", () => {
    const noData = without("source", "data");
    refuses("source", noData);
    refuses("source", noData, { CAREER_DB: "" });
    refuses("source", noData, { CAREER_DB: path.join(REPO, "data", "career.db") });
    refuses("source", noData, { CAREER_DB: path.join(os.homedir(), "AppData", "Local", "MSFS Career Map", "career.db") });
    refuses("source", noData, { CAREER_DB: path.join(runDir, "..", "career.db") });
    passes("source", noData, { CAREER_DB: path.join(runDir, "data-x", "career.db") });

    passes("bundled", without("bundled", "data"));
    passes("bundled", without("bundled", "data"), { CAREER_DB: path.join(REPO, "data", "career.db") });
  });

  // @spec APP-RUN-021
  it("checks every launch before it starts a process", PROCESS, async () => {
    // Harmless even unchecked: given both backups arguments, the server refuses to start.
    await expect(launchServer({ entry: "bundled", args: ["--backups-documents=MSFS Career Map\\Backups"] })).rejects.toThrow(
      /^checkTestServerArgs: /,
    );
  });
});

describe("the browser tests' readiness check: waitForTestServer", () => {
  type Answer = "drop" | { status?: number; json?: unknown; text?: string };

  /**
   * A local stand-in for `/api/status` behind the page server, let through the fetch guard: it answers
   * each request with the next of `answers`, the last one repeating; "drop" closes the connection.
   */
  async function statusStub(answers: Answer[]) {
    let asked = 0;
    const server = http.createServer((req, res) => {
      const a = answers[Math.min(asked, answers.length - 1)];
      asked++;
      if (a === "drop") {
        req.socket.destroy();
        return;
      }
      const body = a.json !== undefined ? JSON.stringify(a.json) : (a.text ?? "");
      res.writeHead(a.status ?? 200, { "content-type": a.json !== undefined ? "application/json" : "text/plain" });
      res.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
    const disallow = allowOrigin(base);
    return {
      url: `${base}/api/status`,
      asked: () => asked,
      close: async () => {
        disallow();
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      },
    };
  }
  const airports = () => fixtureCounts().airports;

  // @spec APP-RUN-017
  it("asks again through no answer, an error and answers not ready yet, and checks the airport count only once ready", async () => {
    const s = await statusStub([
      "drop",
      { status: 502, text: "Bad Gateway" },
      { json: { ok: true, startup: "opening", ready: false, airports: null } },
      { json: { ok: true, startup: "done", ready: false, airports: 0 } },
      { json: { ok: true, startup: "done", ready: true, airports: airports() } },
    ]);
    try {
      await expect(waitForTestServer(s.url, { intervalMs: 20 })).resolves.toBeUndefined();
      // It stopped at the first ready answer.
      expect(s.asked()).toBe(5);
      await new Promise((r) => setTimeout(r, 100));
      expect(s.asked()).toBe(5);
    } finally {
      await s.close();
    }
  });

  // @spec APP-RUN-017
  it("rejects, naming the timeout, when the server never reports ready", async () => {
    const s = await statusStub([{ json: { ok: true, startup: "done", ready: false, airports: airports() } }]);
    try {
      const started = Date.now();
      await expect(waitForTestServer(s.url, { timeoutMs: 500, intervalMs: 50 })).rejects.toThrow(
        /^timed out: .* did not report ready within 500 ms/,
      );
      const took = Date.now() - started;
      expect(took).toBeGreaterThanOrEqual(490);
      expect(took).toBeLessThan(3000);
      expect(s.asked()).toBeGreaterThan(2);
    } finally {
      await s.close();
    }
  });

  // @spec APP-RUN-017
  it("rejects in time when the server accepts and never answers", async () => {
    const silent = await silentPort();
    const disallow = allowOrigin(`http://127.0.0.1:${silent.port}`);
    try {
      const started = Date.now();
      await expect(waitForTestServer(`http://127.0.0.1:${silent.port}/api/status`, { timeoutMs: 500, intervalMs: 50 })).rejects.toThrow(
        /^timed out: .* did not report ready within 500 ms/,
      );
      expect(Date.now() - started).toBeLessThan(3000);
    } finally {
      disallow();
      silent.close();
    }
  });

  // @spec APP-RUN-017
  it("rejects at once, naming the airport count, when the ready server reports another count than the fixture lists'", async () => {
    const s = await statusStub([{ json: { ok: true, startup: "done", ready: true, airports: airports() + 1 } }]);
    try {
      const started = Date.now();
      await expect(waitForTestServer(s.url)).rejects.toThrow(
        new RegExp(`^airport count mismatch: .* reports ${airports() + 1} airports, not the fixture lists' ${airports()}`),
      );
      expect(Date.now() - started).toBeLessThan(2000);
      expect(s.asked()).toBe(1);
      // The count to expect can be given.
      await expect(waitForTestServer(s.url, { airports: airports() + 1 })).resolves.toBeUndefined();
    } finally {
      await s.close();
    }
  });

  // @spec APP-RUN-017
  it("is what the browser-test run calls first, asking /api/status through the page server on 127.0.0.1:5183", async () => {
    // Answered here, so nothing connects to the page server's port.
    let count = airports();
    answerFetch(`http://127.0.0.1:${E2E_PAGE_PORT}/api/status`, () => Response.json({ ok: true, startup: "done", ready: true, airports: count }));
    await expect(checkTestServer()).resolves.toBeUndefined();
    count = airports() + 1;
    await expect(checkTestServer()).rejects.toThrow(/^airport count mismatch: http:\/\/127\.0\.0\.1:5183\/api\/status reports/);
    expect(takeRefused()).toEqual([]);
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
  it("has the page's dev server on 127.0.0.1:5173 pass /api/ and /images/ to the server on 127.0.0.1 at PORT, 3080 by default", async () => {
    delete process.env.PORT;
    vi.resetModules();
    const byDefault = (await import("../../vite.config.ts")).default as ViteConfig;
    expect(byDefault.server).toEqual({
      host: "127.0.0.1",
      port: 5173,
      proxy: { "/api/": "http://127.0.0.1:3080", "/images/": "http://127.0.0.1:3080" },
    });

    process.env.PORT = "4321";
    vi.resetModules();
    const moved = (await import("../../vite.config.ts")).default as ViteConfig;
    expect(moved.server).toEqual({
      host: "127.0.0.1",
      port: 5173,
      proxy: { "/api/": "http://127.0.0.1:4321", "/images/": "http://127.0.0.1:4321" },
    });
  });

  // @spec APP-RUN-001
  it("keeps the page's own modules, such as /api.ts, on the dev server", async () => {
    const config = (await import("../../vite.config.ts")).default as ViteConfig;
    // Vite passes on every path that starts with a proxy key.
    for (const own of ["/api.ts", "/images.ts", "/App.tsx"]) {
      expect(Object.keys(config.server.proxy).filter((k) => own.startsWith(k)), own).toEqual([]);
    }
  });

  // @spec APP-RUN-012, APP-RUN-016, APP-RUN-017
  it("starts the browser-test servers on 127.0.0.1 at their own ports, never reusing a server already there", async () => {
    const config = (await import("../../playwright.config.ts")).default;
    expect(E2E_API_PORT).toBe(3180);
    expect(E2E_PAGE_PORT).toBe(5183);
    expect(config.workers).toBe(1);
    expect(config.fullyParallel).toBe(false);
    expect(config.globalSetup).toBe("./tests/e2e/global-setup.ts");
    expect(config.use?.baseURL).toBe("http://127.0.0.1:5183");
    expect(config.projects?.map((p) => p.name)).toEqual(["chromium"]);
    expect(config.webServer).toEqual([
      {
        command:
          "node --no-warnings=ExperimentalWarning --import tsx tests/support/e2e-server.ts --port=3180 --sim=fake --airport-downloads=off",
        url: "http://127.0.0.1:3180/api/status",
        reuseExistingServer: false,
        timeout: 60_000,
        stdout: "pipe",
      },
      {
        command: "npx vite --host 127.0.0.1 --port 5183 --strictPort",
        url: "http://127.0.0.1:5183",
        env: { PORT: "3180" },
        reuseExistingServer: false,
        timeout: 60_000,
      },
    ]);
  });
});
