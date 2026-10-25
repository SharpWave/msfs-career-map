/**
 * The desktop build (scripts/desktop-build.ts; m2 contract §15), run here into temp folders with the
 * real esbuild and never Vite:
 * - the server bundled into an ES module, `server.mjs`, with its start-up worker beside it as a second
 *   one, `startup-worker.mjs`, both with a `require` shim and the version built in
 *   (DESK-DIST-PKG-009), node-simconnect left out of the bundle (DESK-DIST-PKG-010, the bundle's half);
 * - the shell bundled into one CommonJS file, `main.cjs`, with the version built in
 *   (DESK-DIST-PKG-011);
 * - the page build copied from `dist/` into the desktop build output as `page/`, nothing else there
 *   emptied (DESK-DIST-PKG-022, the build output's half), and the app manifest that makes the output
 *   folder runnable by Electron (DESK-DIST-DEV-001);
 * - the seed airport lists with their download times (DESK-DIST-PKG-012), downloaded when one is
 *   missing or `--fresh` is given (DESK-DIST-PKG-020) and otherwise kept with no request
 *   (DESK-DIST-PKG-021);
 * - the window's and the tray's icons written into `icons/` (DESK-DIST-PKG-015, DESK-DIST-PKG-016);
 * - Electron started on the build output in test mode on `.desktop-dev`, without
 *   `ELECTRON_RUN_AS_NODE` (DESK-DIST-DEV-001, DESK-DIST-DEV-005).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { answerFetch } from "../../support/fetch-guard.ts";
import {
  buildDesktop,
  bundleServer,
  bundleShell,
  copyPage,
  electronCommand,
  seedLists,
  writeAppManifest,
  writeIcons,
} from "../../../scripts/desktop-build.ts";
import { trayIcons } from "../../../scripts/tray-icons.ts";
import { tempFolder } from "../support/fakes.ts";

const win = path.win32;
const REPO = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const PACKAGE_VERSION: string = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8")).version;
const TEST_VERSION = "9.9.9-test";

const BANNER =
  'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);';

const AIRPORTS_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv";
const RUNWAYS_URL = "https://davidmegginson.github.io/ourairports-data/runways.csv";
const USER_AGENT = `MSFSCareerMap/${PACKAGE_VERSION} (+https://github.com/SharpWave/msfs-career-map)`;
const NEW_AIRPORTS = 'id,ident,type,name\n1,"KBOS","large_airport","Boston Logan"\n';
const NEW_RUNWAYS = 'id,airport_ref,airport_ident,length_ft\n10,1,"KBOS",10083\n';
const DOWNLOADED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z\n$/;

const read = (file: string) => fs.readFileSync(file, "utf8");
/** The script files a folder holds, sorted. */
const scripts = (folder: string) => fs.readdirSync(folder).filter((f) => /\.(c|m)?js$/.test(f)).sort();

/** Answers both lists' downloads, recording each request's URL and User-Agent. */
function answerLists(o: { airports?: number; runways?: number } = {}): { url: string; userAgent: string | null }[] {
  const calls: { url: string; userAgent: string | null }[] = [];
  const reply = (body: string, status: number) => (url: URL, init?: RequestInit) => {
    calls.push({ url: url.href, userAgent: new Headers(init?.headers).get("user-agent") });
    return status === 200 ? new Response(body) : new Response("unavailable", { status, statusText: "Service Unavailable" });
  };
  answerFetch(AIRPORTS_URL, reply(NEW_AIRPORTS, o.airports ?? 200));
  answerFetch(RUNWAYS_URL, reply(NEW_RUNWAYS, o.runways ?? 200));
  return calls;
}

/** A desktop build output already holding both lists and their times (from an earlier build). */
function outWithLists(o: { skip?: string } = {}): { out: string; before: Record<string, string> } {
  const out = tempFolder("desktop-out-");
  const files: Record<string, string> = {
    "airports.csv": "id,ident\n1,OLD1\n",
    "runways.csv": "id,airport_ident\n1,OLD1\n",
    "airports.csv.downloaded": "2026-09-01T08:00:00.000Z\n",
    "runways.csv.downloaded": "2026-09-01T08:00:01.000Z\n",
  };
  const before: Record<string, string> = {};
  for (const [name, text] of Object.entries(files)) {
    if (name === o.skip) continue;
    fs.writeFileSync(path.join(out, name), text);
    before[name] = text;
  }
  return { out, before };
}

const listFiles = ["airports.csv", "runways.csv", "airports.csv.downloaded", "runways.csv.downloaded"];
function contents(out: string): Record<string, string | null> {
  return Object.fromEntries(listFiles.map((f) => [f, fs.existsSync(path.join(out, f)) ? read(path.join(out, f)) : null]));
}

// ---------------------------------------------------------------------------------------------

describe("the server bundle", () => {
  let out: string;
  let inputs: string[];
  let server: string;
  let worker: string;

  beforeAll(async () => {
    out = tempFolder("server-bundle-");
    ({ inputs } = await bundleServer(REPO, out, TEST_VERSION));
    server = read(path.join(out, "server.mjs"));
    worker = read(path.join(out, "startup-worker.mjs"));
  }, 120_000);

  // @spec DESK-DIST-PKG-009
  it("is an ES module, server.mjs, with its start-up worker beside it as a second one, startup-worker.mjs", () => {
    expect(scripts(out)).toEqual(["server.mjs", "startup-worker.mjs"]);
  });

  // @spec DESK-DIST-PKG-009
  it("starts each module with the require shim for its CommonJS dependencies", () => {
    expect(server.startsWith(BANNER)).toBe(true);
    expect(worker.startsWith(BANNER)).toBe(true);
  });

  // @spec DESK-DIST-PKG-009
  it("starts its worker from startup-worker.mjs beside it, never from the source's startup-worker.ts", () => {
    expect(server).toContain('new URL("./startup-worker.mjs", import.meta.url)');
    expect(server).not.toContain("startup-worker.ts");
    // (The worker's own bundle names its source file in esbuild's module comment, so only the URL is checked there.)
    expect(worker).not.toContain('"./startup-worker.ts"');
  });

  // @spec DESK-DIST-PKG-009
  it("has the given version built in", () => {
    expect(server).toContain(JSON.stringify(TEST_VERSION));
    expect(server).not.toContain("__MSFS_CAREER_MAP_VERSION__");
    expect(worker).not.toContain("__MSFS_CAREER_MAP_VERSION__");
  });

  // @spec DESK-DIST-PKG-010
  it("leaves node-simconnect out, imported from beside the program at run time", () => {
    expect(server).toContain('from "node-simconnect"');
    expect(inputs.filter((f) => /node_modules[\\/]node-simconnect/.test(f))).toEqual([]);
  });

  // @spec DESK-DIST-PKG-009
  it("names its inputs as absolute Windows paths, the bundled entry among them", () => {
    expect(inputs.length).toBeGreaterThan(1);
    expect(inputs.filter((f) => !win.isAbsolute(f))).toEqual([]);
    expect(inputs).toContain(win.join(REPO, "src", "server", "bundled.ts"));
  });
});

describe("the shell bundle", () => {
  let out: string;
  let inputs: string[];
  let main: string;

  beforeAll(async () => {
    out = tempFolder("shell-bundle-");
    ({ inputs } = await bundleShell(REPO, out, TEST_VERSION));
    main = read(path.join(out, "main.cjs"));
  }, 120_000);

  // @spec DESK-DIST-PKG-011
  it("is one CommonJS file, main.cjs, loading Electron at run time", () => {
    expect(scripts(out)).toEqual(["main.cjs"]);
    expect(main).toContain('require("electron")');
  });

  // @spec DESK-DIST-PKG-011
  it("has the given version built in", () => {
    expect(main).toContain(JSON.stringify(TEST_VERSION));
    expect(main).not.toContain("__MSFS_CAREER_MAP_VERSION__");
  });

  // @spec DESK-DIST-PKG-011
  it("bundles src/desktop from its entry, with nothing of src/server or Electron among its inputs", () => {
    expect(inputs.filter((f) => !win.isAbsolute(f))).toEqual([]);
    expect(inputs).toContain(win.join(REPO, "src", "desktop", "main.ts"));
    const serverFolder = win.join(REPO, "src", "server") + "\\";
    expect(inputs.filter((f) => f.toLowerCase().startsWith(serverFolder.toLowerCase()))).toEqual([]);
    expect(inputs.filter((f) => /node_modules[\\/]electron[\\/]/.test(f))).toEqual([]);
  });
});

describe("the page in the desktop build output", () => {
  /** A stand-in repository holding only a page build in dist/. */
  function fakeRepo(o: { index?: boolean } = {}): string {
    const repo = tempFolder("fake-repo-");
    fs.mkdirSync(path.join(repo, "dist", "assets"), { recursive: true });
    if (o.index !== false) fs.writeFileSync(path.join(repo, "dist", "index.html"), "<!doctype html><title>MSFS Career Map</title>");
    fs.writeFileSync(path.join(repo, "dist", "assets", "app-123.js"), "console.log('page');");
    return repo;
  }

  // @spec DESK-DIST-PKG-022
  it("is the page build from dist/ copied whole as page/, replacing an older copy and nothing else", () => {
    const repo = fakeRepo();
    const out = tempFolder("desktop-out-");
    fs.mkdirSync(path.join(out, "page"), { recursive: true });
    fs.writeFileSync(path.join(out, "page", "old.js"), "stale");
    fs.writeFileSync(path.join(out, "airports.csv"), "id,ident\n");
    fs.writeFileSync(path.join(out, "server.mjs"), "// an earlier bundle");

    copyPage(repo, out);

    expect(read(path.join(out, "page", "index.html"))).toBe("<!doctype html><title>MSFS Career Map</title>");
    expect(read(path.join(out, "page", "assets", "app-123.js"))).toBe("console.log('page');");
    expect(fs.existsSync(path.join(out, "page", "old.js"))).toBe(false);
    expect(fs.readdirSync(path.join(out, "page")).sort()).toEqual(["assets", "index.html"]);
    expect(read(path.join(out, "airports.csv"))).toBe("id,ident\n");
    expect(read(path.join(out, "server.mjs"))).toBe("// an earlier bundle");
    expect(read(path.join(repo, "dist", "index.html"))).toBe("<!doctype html><title>MSFS Career Map</title>");
  });

  // @spec DESK-DIST-PKG-022
  it("is refused when dist/ holds no page build, the earlier copy left as it was", () => {
    const repo = fakeRepo({ index: false });
    const out = tempFolder("desktop-out-");
    fs.mkdirSync(path.join(out, "page"), { recursive: true });
    fs.writeFileSync(path.join(out, "page", "old.js"), "earlier");
    expect(() => copyPage(repo, out)).toThrow("dist/ holds no page build: run vite build first");
    expect(read(path.join(out, "page", "old.js"))).toBe("earlier");
  });

  // @spec DESK-DIST-DEV-001, DESK-DIST-PKG-022
  it("comes first in the whole build, so a missing page build stops it before anything else is written", async () => {
    const repo = fakeRepo({ index: false });
    const out = tempFolder("desktop-out-");
    fs.writeFileSync(path.join(out, "marker.txt"), "x");
    await expect(
      Promise.resolve().then(() => buildDesktop({ repo, out, version: TEST_VERSION, fresh: false, log: () => {} })),
    ).rejects.toThrow("dist/ holds no page build: run vite build first");
    expect(fs.readdirSync(out)).toEqual(["marker.txt"]);
  });

  // @spec DESK-DIST-DEV-001, DESK-DIST-PKG-022
  it("is copied before the bundles, and a bundle that fails stops the build before the lists, icons and manifest", async () => {
    // A stand-in repository with a page build but no source: the server bundle, next in order, cannot build.
    // Were the seed lists fetched before it, the guard would refuse the request and fail this test.
    const repo = fakeRepo();
    const out = tempFolder("desktop-out-");
    await expect(
      Promise.resolve().then(() => buildDesktop({ repo, out, version: TEST_VERSION, fresh: false, log: () => {} })),
    ).rejects.toThrow();
    expect(read(path.join(out, "page", "index.html"))).toBe("<!doctype html><title>MSFS Career Map</title>");
    expect(fs.readdirSync(out)).toEqual(["page"]);
  });
});

describe("the app manifest", () => {
  // @spec DESK-DIST-DEV-001
  it("is package.json in the build output, naming main.cjs so Electron runs the shell bundle", () => {
    const out = tempFolder("desktop-out-");
    writeAppManifest(out, TEST_VERSION);
    const text = read(path.join(out, "package.json"));
    const expected = {
      name: "msfs-career-map",
      productName: "MSFS Career Map",
      version: TEST_VERSION,
      private: true,
      type: "commonjs",
      main: "main.cjs",
    };
    expect(JSON.parse(text)).toEqual(expected);
    expect(text.trimEnd()).toBe(JSON.stringify(expected, null, 2));
  });
});

describe("the seed airport lists", () => {
  // @spec DESK-DIST-PKG-012, DESK-DIST-PKG-020
  it("are downloaded into an output lacking them, with the app's User-Agent, each with its download time", async () => {
    const out = tempFolder("desktop-out-");
    const calls = answerLists();
    const before = Date.now();
    expect(await seedLists(out, false, () => {})).toBe("downloaded");
    const after = Date.now();

    expect(calls.map((c) => c.url).sort()).toEqual([AIRPORTS_URL, RUNWAYS_URL]);
    expect(calls.map((c) => c.userAgent)).toEqual([USER_AGENT, USER_AGENT]);
    expect(read(path.join(out, "airports.csv"))).toBe(NEW_AIRPORTS);
    expect(read(path.join(out, "runways.csv"))).toBe(NEW_RUNWAYS);
    for (const list of ["airports.csv", "runways.csv"]) {
      const time = read(path.join(out, `${list}.downloaded`));
      expect(time).toMatch(DOWNLOADED);
      const t = Date.parse(time.trim());
      expect(t).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
      expect(t).toBeLessThanOrEqual(after);
    }
  });

  // @spec DESK-DIST-PKG-021
  it("are kept with their times, and nothing requested, when the output holds both with their times", async () => {
    const { out, before } = outWithLists();
    const calls = answerLists();
    expect(await seedLists(out, false, () => {})).toBe("kept");
    expect(calls).toEqual([]);
    expect(contents(out)).toEqual(before);
  });

  // @spec DESK-DIST-PKG-020
  it("are downloaded again, both replaced, with --fresh", async () => {
    const { out } = outWithLists();
    const calls = answerLists();
    expect(await seedLists(out, true, () => {})).toBe("downloaded");
    expect(calls.map((c) => c.url).sort()).toEqual([AIRPORTS_URL, RUNWAYS_URL]);
    const now = contents(out);
    expect(now["airports.csv"]).toBe(NEW_AIRPORTS);
    expect(now["runways.csv"]).toBe(NEW_RUNWAYS);
    expect(now["airports.csv.downloaded"]).toMatch(DOWNLOADED);
    expect(now["airports.csv.downloaded"]).not.toBe("2026-09-01T08:00:00.000Z\n");
    expect(now["runways.csv.downloaded"]).toMatch(DOWNLOADED);
    expect(now["runways.csv.downloaded"]).not.toBe("2026-09-01T08:00:01.000Z\n");
  });

  // @spec DESK-DIST-PKG-020
  it("are both downloaded when one list's download time is missing", async () => {
    const { out } = outWithLists({ skip: "runways.csv.downloaded" });
    const calls = answerLists();
    expect(await seedLists(out, false, () => {})).toBe("downloaded");
    expect(calls.map((c) => c.url).sort()).toEqual([AIRPORTS_URL, RUNWAYS_URL]);
    const now = contents(out);
    expect(now["airports.csv"]).toBe(NEW_AIRPORTS);
    expect(now["runways.csv"]).toBe(NEW_RUNWAYS);
    expect(now["airports.csv.downloaded"]).toMatch(DOWNLOADED);
    expect(now["runways.csv.downloaded"]).toMatch(DOWNLOADED);
  });

  // @spec DESK-DIST-PKG-020
  it("are both downloaded when one list is missing", async () => {
    const { out } = outWithLists({ skip: "airports.csv" });
    const calls = answerLists();
    expect(await seedLists(out, false, () => {})).toBe("downloaded");
    expect(calls.map((c) => c.url).sort()).toEqual([AIRPORTS_URL, RUNWAYS_URL]);
    expect(read(path.join(out, "airports.csv"))).toBe(NEW_AIRPORTS);
    expect(read(path.join(out, "runways.csv"))).toBe(NEW_RUNWAYS);
  });

  // @spec DESK-DIST-PKG-020, DESK-DIST-PKG-012
  it("are left as they were when a download fails, and the build fails", async () => {
    const { out, before } = outWithLists();
    answerLists({ runways: 503 });
    await expect(seedLists(out, true, () => {})).rejects.toThrow();
    expect(contents(out)).toEqual(before);
  });

  // @spec DESK-DIST-PKG-020
  it("are put in place only once both have arrived", async () => {
    const out = tempFolder("desktop-out-");
    answerLists({ runways: 503 });
    await expect(seedLists(out, false, () => {})).rejects.toThrow();
    expect(contents(out)).toEqual({
      "airports.csv": null,
      "runways.csv": null,
      "airports.csv.downloaded": null,
      "runways.csv.downloaded": null,
    });
  });
});

describe("the icons in the build output", () => {
  // @spec DESK-DIST-PKG-015, DESK-DIST-PKG-016
  it("are the window's career-map.ico, copied byte for byte, and the six tray icons", () => {
    const out = tempFolder("desktop-out-");
    writeIcons(REPO, out);
    const icons = path.join(out, "icons");
    expect(fs.readdirSync(icons).sort()).toEqual([
      "career-map.ico",
      "tray-amber.ico",
      "tray-blue.ico",
      "tray-green.ico",
      "tray-red.ico",
      "tray-violet.ico",
      "tray.ico",
    ]);
    const mark = fs.readFileSync(path.join(REPO, "assets", "career-map.ico"));
    expect(fs.readFileSync(path.join(icons, "career-map.ico")).equals(mark)).toBe(true);
    const made = trayIcons(mark);
    for (const [name, bytes] of Object.entries(made)) {
      expect(fs.readFileSync(path.join(icons, `${name}.ico`)).equals(bytes)).toBe(true);
    }
  });
});

describe("starting Electron for npm run desktop", () => {
  // @spec DESK-DIST-DEV-001, DESK-DIST-DEV-005
  it("runs the build output in test mode on .desktop-dev in the repository, without ELECTRON_RUN_AS_NODE", () => {
    const env = {
      Path: "C:\\Windows\\system32;C:\\Windows",
      TEMP: "C:\\Users\\pilot\\AppData\\Local\\Temp",
      ELECTRON_RUN_AS_NODE: "1",
      Electron_Run_As_Node: "1",
      NODE_ENV: "development",
    };
    const electron = "C:\\repo\\node_modules\\electron\\dist\\electron.exe";
    expect(electronCommand("C:\\repo", electron, env)).toEqual({
      command: electron,
      args: ["C:\\repo\\build\\desktop", "--test-data=C:\\repo\\.desktop-dev"],
      env: {
        Path: "C:\\Windows\\system32;C:\\Windows",
        TEMP: "C:\\Users\\pilot\\AppData\\Local\\Temp",
        NODE_ENV: "development",
      },
    });
  });

  // @spec DESK-DIST-DEV-005
  it("keeps the environment whole when ELECTRON_RUN_AS_NODE is not set", () => {
    const env = { Path: "C:\\Windows", USERPROFILE: "C:\\Users\\pilot" };
    const c = electronCommand("D:\\src\\msfs-career-map", "D:\\electron.exe", env);
    expect(c.args).toEqual(["D:\\src\\msfs-career-map\\build\\desktop", "--test-data=D:\\src\\msfs-career-map\\.desktop-dev"]);
    expect(c.env).toEqual(env);
  });
});
