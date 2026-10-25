/**
 * The server started as a process: what it does, in order, from the moment it listens; where it
 * takes its inputs from in each form; and what it leaves behind.
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from "vitest";
import { rawRequest } from "../support/raw-http.ts";
import { fixtureCounts, makeDataFolder } from "../support/run-folder.ts";
import {
  killAllServers,
  killTestServers,
  launchServer,
  lockAt,
  makeProgramFolder,
  REPO,
  slowStalePort,
  type LaunchedServer,
} from "../support/server-process.ts";

afterEach(killTestServers);
afterAll(killAllServers);

const runDir = inject("runDir");
const VERSION: string = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8")).version;
const LISTENING_LINE = /^\[server\] listening on http:\/\/127\.0\.0\.1:(\d+); data folder (.+); sim (link|fake|off); version (\S+)$/m;
const PROCESS = { timeout: 30_000 };
// Any bytes do: the server serves the file as it is.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
const SAMPLE = {
  t: Date.now(), lat: 41.7246, lon: -71.4282, alt_ft: 55, on_ground: true, gs_kts: 0, hdg_deg: 50,
  title: "Process Test Aircraft", livery: "", atc_id: "N0PT",
};
const FEED_OFF = { error: "the fake feed is off: start the server with --sim=fake to accept synthetic samples" };
/** startTracking's lines (contract §10), written once preparation has ended. */
const TRACKING_OFF_LINE = "[sim] tracking off: start with --sim=link to track flights from MSFS";
const FAKE_FEED_LINE = "[sim] fake feed: POST /api/tracker/sample feeds the tracker (npm run sim-fake)";
/** makeProgramFolder's page/app.js, one of the page's own files. */
const APP_JS = 'console.log("test page");';
const exactly = (line: string) => new RegExp(`^${line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

/** Waits for the tracking line, and checks it came after `[server] ready` on stdout. */
async function expectTrackingAfterReady(s: LaunchedServer, line: string) {
  await s.waitForLine(exactly(line));
  const stdout = s.output().split(/\r?\n/);
  const ready = stdout.indexOf("[server] ready");
  expect(ready, "the [server] ready line").toBeGreaterThan(-1);
  expect(stdout.indexOf(line), `${line} after [server] ready`).toBeGreaterThan(ready);
}

const get = (s: LaunchedServer, p: string) => fetch(`${s.base}${p}`);
const postSample = (s: LaunchedServer) =>
  fetch(`${s.base}/api/tracker/sample`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(SAMPLE),
  });
const pageOf = (programFolder: string) => fs.readFileSync(path.join(programFolder, "page", "index.html"), "utf8");
/** A new, empty folder in the run folder. */
const freshFolder = (kind: string) => fs.mkdtempSync(path.join(runDir, `${kind}-`));

describe("starting: listening first, then the start-up work", () => {
  // @spec APP-SRV-001, APP-SRV-009, APP-SRV-003, APP-API-004, APP-API-008, APP-API-009, APP-DATA-007
  it("answers from the stand-in while its start is held in opening, then from the full app once ready", PROCESS, async () => {
    const dataFolder = makeDataFolder(runDir).dir;
    const programFolder = makeProgramFolder();
    const page = pageOf(programFolder);
    fs.mkdirSync(path.join(dataFolder, "images"));
    fs.writeFileSync(path.join(dataFolder, "images", "x.png"), PNG);
    // A lock naming a running process (this one) on a port that answers as another app after 1.5 s:
    // the server's stale check holds its start in `opening` until then, before it opens the database.
    const holder = await slowStalePort();
    fs.writeFileSync(path.join(dataFolder, "career.db.lock"), `${JSON.stringify({ pid: process.pid, port: holder.port })}\n`);
    try {
      const s = await launchServer({ entry: "bundled", dataFolder, programFolder });
      const line = await s.waitForLine(/^\[server\] listening on /);
      const m = LISTENING_LINE.exec(line);
      expect(m, line).not.toBeNull();
      expect(Number(m![1])).toBe(s.port);
      expect(s.port).toBeGreaterThan(0);
      expect(m![2]).toBe(path.resolve(dataFolder));
      expect(m![3]).toBe("off");
      expect(m![4]).toBe(VERSION);

      // All at once, right after the listening line, inside the hold.
      const [status, tracker, icon, root, deep, appJs, noIcon, crossSite, foreignHost] = await Promise.all([
        s.status(),
        get(s, "/api/tracker"),
        get(s, "/images/x.png"),
        get(s, "/"),
        get(s, "/deep/link"),
        get(s, "/app.js"),
        get(s, "/images/missing.png"),
        rawRequest(s.base, {
          method: "POST",
          path: "/api/aircraft",
          headers: { "Sec-Fetch-Site": "cross-site", "Content-Type": "application/json" },
          body: JSON.stringify({ name: "Cross-site Cub" }),
        }),
        rawRequest(s.base, { path: "/api/status", headers: { Host: "evil.example" } }),
      ]);
      expect(status).toMatchObject({
        ok: true,
        app: "msfs-career-map",
        version: VERSION,
        pid: s.child.pid,
        dataFolder: path.resolve(dataFolder),
        sim: "off",
        startup: "opening",
        ready: false,
        logbookId: null,
        airports: null,
        runways: null,
      });
      expect(status.airportData).toEqual({ state: "waiting" });

      expect(tracker.status).toBe(503);
      expect(tracker.headers.get("retry-after")).toBe("1");
      expect(await tracker.json()).toEqual({ error: "MSFS Career Map is starting (opening)" });

      expect(icon.status).toBe(200);
      expect(Buffer.from(await icon.arrayBuffer()).equals(PNG)).toBe(true);

      expect(root.status).toBe(200);
      expect(await root.text()).toBe(page);
      expect(deep.status).toBe(200);
      expect(await deep.text()).toBe(page);
      // The page's own files, not its index.html in their place; an icon that is not there is 404.
      expect(appJs.status).toBe(200);
      expect(await appJs.text()).toBe(APP_JS);
      expect(noIcon.status).toBe(404);
      expect(await noIcon.text()).not.toBe(page);

      expect(crossSite.status).toBe(403);
      expect(crossSite.json()).toEqual({ error: "refused: a change asked for by another site" });
      expect(foreignHost.status).toBe(403);
      expect(foreignHost.json()).toEqual({ error: "refused: this server answers only 127.0.0.1 and localhost" });

      // Proof that all of the above landed inside the hold: no database yet, still opening.
      expect(fs.existsSync(path.join(dataFolder, "career.db"))).toBe(false);
      expect((await s.status()).startup).toBe("opening");
      expect(s.output()).not.toContain("[server] start-up done");

      // Then the start-up work, the airport preparation, and the full app.
      await s.waitForLine(/^\[server\] start-up done$/);
      await s.waitForLine(/^\[server\] ready$/);
      const out = s.output();
      expect(out.indexOf("[server] listening on ")).toBeLessThan(out.indexOf("[server] start-up done"));
      expect(out.indexOf("[server] start-up done")).toBeLessThan(out.indexOf("[server] ready"));

      const after = await s.status();
      expect(after).toMatchObject({
        startup: "done",
        ready: true,
        airportData: { state: "done" },
        airports: fixtureCounts().airports,
        runways: fixtureCounts().runways,
      });
      expect(after).toHaveProperty("logbookId");
      expect(lockAt(dataFolder)).toEqual({ pid: s.child.pid, port: s.port });

      expect((await get(s, "/api/tracker")).status).toBe(200);
      const nope = await get(s, "/api/nope");
      expect(nope.status).toBe(404);
      expect(await nope.json()).toEqual({ error: "not found" });
      const deepAfter = await get(s, "/deep/link");
      expect(deepAfter.status).toBe(200);
      expect(await deepAfter.text()).toBe(page);
      // The full app serves the page's files and the icons as the stand-in did.
      const [appJsAfter, iconAfter, noIconAfter] = await Promise.all([get(s, "/app.js"), get(s, "/images/x.png"), get(s, "/images/missing.png")]);
      expect(appJsAfter.status).toBe(200);
      expect(await appJsAfter.text()).toBe(APP_JS);
      expect(iconAfter.status).toBe(200);
      expect(Buffer.from(await iconAfter.arrayBuffer()).equals(PNG)).toBe(true);
      expect(noIconAfter.status).toBe(404);
      expect(await noIconAfter.text()).not.toBe(page);

      // Tracking starts only once the preparation has ended (sim off here: its line, after ready).
      await expectTrackingAfterReady(s, TRACKING_OFF_LINE);
    } finally {
      holder.close();
    }
  });
});

describe("a running server, checked without changing it", () => {
  let s: LaunchedServer;
  let readyAt = 0;
  beforeAll(async () => {
    s = await launchServer({ entry: "bundled", shared: true });
    await s.waitForLine(/^\[server\] ready$/);
    readyAt = Date.now();
  }, 30_000);

  /** Whether a TCP connection to host:port opens within `ms`. */
  const connects = (host: string, port: number, ms: number) =>
    new Promise<{ connected: boolean; code?: string }>((resolve) => {
      const sock = net.connect({ host, port });
      const timer = setTimeout(() => {
        sock.destroy();
        resolve({ connected: false, code: "timeout" });
      }, ms);
      sock.once("connect", () => {
        clearTimeout(timer);
        sock.destroy();
        resolve({ connected: true });
      });
      sock.once("error", (e: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        resolve({ connected: false, code: e.code });
      });
    });

  // @spec APP-SRV-005
  it("listens only on 127.0.0.1: not on the IPv6 loopback, not on the LAN", PROCESS, async () => {
    expect(await connects("127.0.0.1", s.port, 2000)).toEqual({ connected: true });
    expect(await connects("::1", s.port, 2000)).toEqual({ connected: false, code: "ECONNREFUSED" });
    const lan = Object.values(os.networkInterfaces())
      .flat()
      .find((a) => a && (a.family === "IPv4" || (a.family as unknown) === 4) && !a.internal);
    if (lan) expect((await connects(lan.address, s.port, 2000)).connected, lan.address).toBe(false);
  });

  // @spec APP-API-004, APP-API-009
  it("reports its own process, version and data folder in /api/status", PROCESS, async () => {
    const st = await s.status();
    expect(st).toMatchObject({
      ok: true,
      app: "msfs-career-map",
      pid: s.child.pid,
      version: VERSION,
      sim: "off",
      startup: "done",
      ready: true,
      airportData: { state: "done" },
      airports: fixtureCounts().airports,
      runways: fixtureCounts().runways,
    });
    expect(st).toHaveProperty("logbookId");
    expect(typeof st.dataFolder).toBe("string");
    expect(path.isAbsolute(st.dataFolder)).toBe(true);
    expect(st.dataFolder).toBe(path.resolve(s.dataFolder));
  });

  // Keep last in this describe: it waits on the clock.
  // @spec APP-SRV-015
  it("keeps running once ready, with nothing asking it to stop", PROCESS, async () => {
    const remainder = readyAt + 2000 - Date.now();
    if (remainder > 0) await new Promise((r) => setTimeout(r, remainder));
    expect(s.child.exitCode).toBeNull();
    expect(s.child.signalCode).toBeNull();
    expect(await s.status()).toMatchObject({ ok: true, pid: s.child.pid, ready: true });
  });
});

describe("where the inputs come from", () => {
  // @spec APP-SRV-006, LIVE-LINK-012, LIVE-API-013
  it("in the bundled form, reads no environment variable, and takes the fake feed from --sim=fake alone", PROCESS, async () => {
    const elsewhere = freshFolder("elsewhere");
    const [s, fake] = await Promise.all([
      launchServer({
        entry: "bundled",
        env: {
          CAREER_DB: path.join(elsewhere, "x.db"),
          PORT: "1",
          TRACKER_FAKE: "1",
          SIMCONNECT_HOST: "192.0.2.1",
          SIMCONNECT_PORT: "500",
        },
      }),
      launchServer({ entry: "bundled", args: ["--sim=fake"] }),
    ]);
    expect(s.port).not.toBe(1);
    await Promise.all([s.waitForLine(/^\[server\] ready$/), fake.waitForLine(/^\[server\] ready$/)]);
    expect(await s.status()).toMatchObject({ sim: "off", dataFolder: path.resolve(s.dataFolder) });
    expect(await (await get(s, "/api/tracker")).json()).toMatchObject({ sim_mode: "off", sim_host: null });
    const sample = await postSample(s);
    expect(sample.status).toBe(403);
    expect(await sample.json()).toEqual(FEED_OFF);
    expect(fs.existsSync(path.join(s.dataFolder, "career.db"))).toBe(true);
    expect(fs.existsSync(path.join(elsewhere, "x.db"))).toBe(false);
    expect(fs.readdirSync(elsewhere)).toEqual([]);

    // --sim=fake, with no TRACKER_FAKE: the fake feed, its line written once preparation has ended.
    expect(LISTENING_LINE.exec(await fake.waitForLine(/^\[server\] listening on /))?.[3]).toBe("fake");
    expect(await fake.status()).toMatchObject({ sim: "fake", dataFolder: path.resolve(fake.dataFolder) });
    expect(await (await get(fake, "/api/tracker")).json()).toMatchObject({ sim_mode: "fake", sim_host: null });
    const fed = await postSample(fake);
    expect(fed.status).toBe(200);
    expect(await fed.json()).toMatchObject({ connected: true });
    await expectTrackingAfterReady(fake, FAKE_FEED_LINE);
  });

  // @spec APP-SRV-007, LIVE-LINK-013, LIVE-API-013, APP-DATA-001, APP-DATA-007
  it("in the source form, takes what its arguments leave out from CAREER_DB, PORT and TRACKER_FAKE", PROCESS, async () => {
    const folder = makeDataFolder(runDir).dir;
    const [fromEnv, offWins, neither] = await Promise.all([
      launchServer({
        entry: "source",
        dataFolder: folder,
        omit: ["--data", "--sim", "--port"],
        env: { CAREER_DB: path.join(folder, "logbook.db"), TRACKER_FAKE: "1", PORT: "0" },
      }),
      launchServer({ entry: "source", env: { TRACKER_FAKE: "1" } }),
      launchServer({ entry: "source", omit: ["--sim"] }),
    ]);
    await Promise.all([fromEnv, offWins, neither].map((s) => s.waitForLine(/^\[server\] ready$/)));

    // CAREER_DB names the database, and its folder is the data folder; TRACKER_FAKE=1 gives the fake feed.
    expect(await fromEnv.status()).toMatchObject({ dataFolder: path.resolve(folder), sim: "fake" });
    expect(LISTENING_LINE.exec(await fromEnv.waitForLine(/^\[server\] listening on /))?.[3]).toBe("fake");
    expect(fs.existsSync(path.join(folder, "logbook.db"))).toBe(true);
    expect(fs.existsSync(path.join(folder, "career.db"))).toBe(false);
    expect(lockAt(folder)).toEqual({ pid: fromEnv.child.pid, port: fromEnv.port });
    expect(await (await get(fromEnv, "/api/tracker")).json()).toMatchObject({ sim_mode: "fake", sim_host: null });
    const fed = await postSample(fromEnv);
    expect(fed.status).toBe(200);
    expect(await fed.json()).toMatchObject({ connected: true });
    await expectTrackingAfterReady(fromEnv, FAKE_FEED_LINE);

    // --sim=off wins over TRACKER_FAKE=1.
    expect((await offWins.status()).sim).toBe("off");
    expect(await (await get(offWins, "/api/tracker")).json()).toMatchObject({ sim_mode: "off" });

    // Neither: off, and the sample route refuses.
    expect((await neither.status()).sim).toBe("off");
    expect(await (await get(neither, "/api/tracker")).json()).toMatchObject({ sim_mode: "off", sim_host: null });
    const refused = await postSample(neither);
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual(FEED_OFF);
  });
});

describe("the page", () => {
  // @spec APP-SRV-003
  it("answers / with a plain-text note when the page folder has no build, and with dist/ by default in the source form", PROCESS, async () => {
    const emptyProgram = freshFolder("program-empty");
    const [noBuild, byDefault] = await Promise.all([
      launchServer({ entry: "source", args: [`--program=${emptyProgram}`] }),
      launchServer({ entry: "source" }),
    ]);
    await Promise.all([noBuild.waitForLine(/^\[server\] ready$/), byDefault.waitForLine(/^\[server\] ready$/)]);

    const note = await get(noBuild, "/");
    expect(note.status).toBe(200);
    expect(note.headers.get("content-type")).toMatch(/^text\/plain/);
    const text = await note.text();
    expect(text).toContain("npm run dev");
    expect(text).toContain("npm run build");

    const dist = path.join(REPO, "dist", "index.html");
    const root = await get(byDefault, "/");
    expect(root.status).toBe(200);
    if (fs.existsSync(dist)) {
      expect(await root.text()).toBe(fs.readFileSync(dist, "utf8"));
    } else {
      expect(root.headers.get("content-type")).toMatch(/^text\/plain/);
      expect(await root.text()).toContain("npm run build");
    }
  });
});

describe("the data folder", () => {
  // The folder holds no airport lists and downloads are off. server-guard.ts refuses any download
  // a server tried anyway, and killTestServers fails the test for it.
  // @spec APP-DATA-001, APP-SRV-001
  it("creates a new nested data folder with career.db in write-ahead logging and images/, and goes on when its lists are missing", PROCESS, async () => {
    const dataFolder = path.join(freshFolder("nested"), "a", "b", "data");
    const s = await launchServer({ entry: "bundled", dataFolder });
    await s.waitForLine(/^\[server\] ready$/);
    expect(fs.statSync(path.join(dataFolder, "career.db")).isFile()).toBe(true);
    expect(fs.statSync(path.join(dataFolder, "images")).isDirectory()).toBe(true);
    // The preparation failed for the missing list, said so, and the server went on to ready.
    expect(await s.waitForLine(/^\[data\] airport preparation failed: /)).toMatch(
      /^\[data\] airport preparation failed: (airports|runways)\.csv is missing and airport downloads are off$/,
    );
    expect(fs.existsSync(path.join(dataFolder, "airports.csv"))).toBe(false);

    s.kill();
    await s.exit();
    const db = new DatabaseSync(path.join(dataFolder, "career.db"));
    try {
      expect(db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    } finally {
      db.close();
    }
  });

  // @spec APP-SRV-021
  it("keeps no log file: it writes nothing but the database, its lock and images", PROCESS, async () => {
    const cwd = freshFolder("cwd");
    const programFolder = makeProgramFolder();
    const logsInRepo = () => fs.readdirSync(REPO).filter((n) => n.endsWith(".log")).sort();
    const repoLogsBefore = logsInRepo();
    const s = await launchServer({ entry: "bundled", cwd, programFolder });
    await s.waitForLine(/^\[server\] ready$/);
    // Some requests, a refused one and failed ones among them, for anything that might log them.
    await Promise.all([
      get(s, "/api/tracker"),
      get(s, "/api/nope"),
      get(s, "/api/airports/ZZZZ9"),
      get(s, "/"),
      rawRequest(s.base, { path: "/api/status", headers: { Host: "evil.example" } }),
    ]);
    s.kill();
    await s.exit();

    expect(fs.readdirSync(cwd)).toEqual([]);
    const allowed = ["airports.csv", "career.db", "career.db-shm", "career.db-wal", "career.db.lock", "images", "runways.csv"];
    const entries = fs.readdirSync(s.dataFolder).sort();
    expect(allowed).toEqual(expect.arrayContaining(entries));
    expect(entries).toEqual(expect.arrayContaining(["career.db", "career.db.lock", "images"]));
    const everything = fs.readdirSync(s.dataFolder, { recursive: true }).map(String);
    expect(everything.filter((n) => n.endsWith(".log"))).toEqual([]);
    expect(fs.readdirSync(programFolder, { recursive: true }).map(String).sort()).toEqual(
      ["page", path.join("page", "app.js"), path.join("page", "index.html")].sort(),
    );
    expect(logsInRepo()).toEqual(repoLogsBefore);
  });
});
