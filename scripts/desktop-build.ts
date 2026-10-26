/**
 * The desktop build: the page, the server and shell bundles, the seed airport lists, the icons and the
 * app manifest, laid out in the desktop build output as the packaged program lays them out.
 *
 *   npm run desktop:build              # vite build, then this into build/desktop
 *   npm run desktop:build -- --fresh   # the same, downloading the seed lists afresh
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";
import { AIRPORTS_URL, RUNWAYS_URL, downloadList, writeDownloadTime } from "../src/server/airport-data.ts";
import { PAGE_RECORD, type PagePackage } from "./page-packages.ts";
import { packageDirOf, thirdPartyNotices, type Part } from "./third-party-notices.ts";
import { trayIcons } from "./tray-icons.ts";

export interface BuildOptions {
  repo: string;
  out: string;
  version: string;
  fresh: boolean;
  log?: (line: string) => void;
}

/** The build `tsx scripts/desktop-build.ts [--fresh]` and `npm run desktop` run: this repository into build/desktop. */
export function buildOptions(argv: readonly string[]): BuildOptions {
  const repo = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  const version: string = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")).version;
  return { repo, out: path.join(repo, "build", "desktop"), version, fresh: argv.includes("--fresh") };
}

/** Everything below, in this order: page, server bundle and its libraries, shell bundle, licences, seed lists, icons, app manifest. */
// @spec DESK-DIST-DEV-001
export async function buildDesktop(o: BuildOptions): Promise<void> {
  const log = o.log ?? ((line: string) => console.log(line));
  copyPage(o.repo, o.out);
  log(`[desktop] page copied into ${path.join(o.out, "page")}`);
  const server = await bundleServer(o.repo, o.out, o.version);
  log("[desktop] server bundled: server.mjs, startup-worker.mjs");
  const libraries = copyServerLibraries(o.repo, o.out);
  log(`[desktop] server libraries copied: ${libraries.join(", ")}`);
  const shell = await bundleShell(o.repo, o.out, o.version);
  log("[desktop] shell bundled: main.cjs");
  writeLicences({ repo: o.repo, out: o.out, serverInputs: server.inputs, shellInputs: shell.inputs, libraries });
  log("[desktop] licences written: LICENSE.txt, THIRD-PARTY-NOTICES.txt");
  const lists = await seedLists(o.out, o.fresh, log);
  log(`[desktop] seed airport lists ${lists}`);
  writeIcons(o.repo, o.out);
  writeAppManifest(o.out, o.version);
  log(`[desktop] built ${o.version} into ${o.out}`);
}

/** Folders of a library package that the server never loads. */
const LIBRARY_LEFT_OUT = new Set(["node_modules", "samples", "examples", "test", "tests", "docs"]);

/**
 * node-simconnect, which the server bundle leaves out, and its own production dependencies, copied from
 * the repository's node_modules into the output's `node_modules` (replacing what was there) as separate
 * files with their licences, so Node finds them beside `server.mjs` and the library can be replaced.
 * Returns the packages copied, sorted.
 */
// @spec DESK-DIST-PKG-010
export function copyServerLibraries(repo: string, out: string): string[] {
  const modules = path.join(out, "node_modules");
  fs.rmSync(modules, { recursive: true, force: true });
  const copied = new Set<string>();
  const queue = ["node-simconnect"];
  while (queue.length > 0) {
    const name = queue.shift()!;
    if (copied.has(name)) continue;
    const from = path.join(repo, "node_modules", name);
    const manifest = JSON.parse(fs.readFileSync(path.join(from, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
    fs.cpSync(from, path.join(modules, name), {
      recursive: true,
      filter: (src) => path.dirname(src) !== from || !LIBRARY_LEFT_OUT.has(path.basename(src)),
    });
    copied.add(name);
    queue.push(...Object.keys(manifest.dependencies ?? {}));
  }
  return [...copied].sort();
}

/**
 * The page build in `dist/` copied into the output as `page/`, replacing an older copy, without the
 * page build's own `.vite/` (its record of the page's packages, which the notices are written from).
 */
// @spec DESK-DIST-PKG-022, DESK-DIST-PKG-025
export function copyPage(repo: string, out: string): void {
  const dist = path.join(repo, "dist");
  if (!fs.existsSync(path.join(dist, "index.html"))) throw new Error("dist/ holds no page build: run vite build first");
  if (!fs.existsSync(path.join(dist, ...PAGE_RECORD))) {
    throw new Error("dist/ holds no record of the page's packages (.vite/packages.json): run vite build first");
  }
  const page = path.join(out, "page");
  fs.rmSync(page, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const record = path.join(dist, PAGE_RECORD[0]);
  fs.cpSync(dist, page, { recursive: true, filter: (src) => src !== record });
}

/**
 * The app's licence, the repository's LICENSE, as `LICENSE.txt`, and the third-party notices for every
 * package the program ships, as `THIRD-PARTY-NOTICES.txt`, both written only once the notices are whole.
 */
// @spec DESK-DIST-PKG-024, DESK-DIST-PKG-026, DESK-DIST-PKG-027
export function writeLicences(o: { repo: string; out: string; serverInputs: string[]; shellInputs: string[]; libraries: string[] }): void {
  const page = JSON.parse(fs.readFileSync(path.join(o.repo, "dist", ...PAGE_RECORD), "utf8")) as { packages: PagePackage[] };
  const fromInputs = (inputs: string[], part: Part) =>
    inputs.flatMap((file) => {
      const dir = packageDirOf(file);
      return dir ? [{ dir, part }] : [];
    });
  const notices = thirdPartyNotices([
    ...page.packages.map((p) => ({ dir: path.join(o.repo, ...p.dir.split("/")), part: "page" as const })),
    ...fromInputs(o.serverInputs, "server"),
    ...fromInputs(o.shellInputs, "desktop shell"),
    ...o.libraries.map((name) => ({ dir: path.join(o.repo, "node_modules", ...name.split("/")), part: "beside the server" as const })),
  ]);
  fs.mkdirSync(o.out, { recursive: true });
  fs.copyFileSync(path.join(o.repo, "LICENSE"), path.join(o.out, "LICENSE.txt"));
  fs.writeFileSync(path.join(o.out, "THIRD-PARTY-NOTICES.txt"), notices);
}

const inputsOf = (repo: string, metafile: { inputs: Record<string, unknown> }) =>
  Object.keys(metafile.inputs).map((k) => path.resolve(repo, k));

const WORKER_URL_SOURCE = 'new URL("./startup-worker.ts", import.meta.url)';
const WORKER_URL_BUNDLED = 'new URL("./startup-worker.mjs", import.meta.url)';

/** Points server.ts's start-up worker at its bundle beside server.mjs; fails unless the source names it exactly once. */
const workerUrl: Plugin = {
  name: "startup-worker-url",
  setup(b) {
    b.onLoad({ filter: /[\\/]src[\\/]server[\\/]server\.ts$/ }, (args) => {
      const source = fs.readFileSync(args.path, "utf8");
      const n = source.split(WORKER_URL_SOURCE).length - 1;
      if (n !== 1) throw new Error(`server.ts should start its worker with ${WORKER_URL_SOURCE} exactly once, found ${n}`);
      return { contents: source.replace(WORKER_URL_SOURCE, WORKER_URL_BUNDLED), loader: "ts" };
    });
  },
};

/**
 * The server as two ES modules, `server.mjs` and its start-up worker `startup-worker.mjs`, each with a
 * `require` shim and the version built in; node-simconnect stays outside, found by Node at run time.
 */
// @spec DESK-DIST-PKG-009, DESK-DIST-PKG-010
export async function bundleServer(repo: string, out: string, version: string): Promise<{ inputs: string[] }> {
  const r = await build({
    absWorkingDir: repo,
    entryPoints: {
      server: path.join(repo, "src", "server", "bundled.ts"),
      "startup-worker": path.join(repo, "src", "server", "startup-worker.ts"),
    },
    outdir: out,
    outExtension: { ".js": ".mjs" },
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node24",
    external: ["node-simconnect"],
    define: { __MSFS_CAREER_MAP_VERSION__: JSON.stringify(version) },
    banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
    plugins: [workerUrl],
    metafile: true,
    logLevel: "warning",
  });
  return { inputs: inputsOf(repo, r.metafile) };
}

/** The shell as one CommonJS file, `main.cjs`, loading Electron at run time, with the version built in. */
// @spec DESK-DIST-PKG-011
export async function bundleShell(repo: string, out: string, version: string): Promise<{ inputs: string[] }> {
  const r = await build({
    absWorkingDir: repo,
    entryPoints: [path.join(repo, "src", "desktop", "main.ts")],
    outfile: path.join(out, "main.cjs"),
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node24",
    external: ["electron"],
    define: { __MSFS_CAREER_MAP_VERSION__: JSON.stringify(version) },
    metafile: true,
    logLevel: "warning",
  });
  return { inputs: inputsOf(repo, r.metafile) };
}

const LISTS = [
  { file: "airports.csv", url: AIRPORTS_URL },
  { file: "runways.csv", url: RUNWAYS_URL },
];

/**
 * The seed airport lists in the output: kept, with nothing requested, when both and their download times
 * are there and `fresh` is not given; otherwise both downloaded under temporary names and put in place
 * with their times only once both have arrived. A failed download leaves the lists there untouched.
 */
// @spec DESK-DIST-PKG-012, DESK-DIST-PKG-020, DESK-DIST-PKG-021
export async function seedLists(out: string, fresh: boolean, log: (line: string) => void = console.log): Promise<"kept" | "downloaded"> {
  const files = LISTS.flatMap((l) => [l.file, `${l.file}.downloaded`]);
  if (!fresh && files.every((f) => fs.existsSync(path.join(out, f)))) return "kept";
  fs.mkdirSync(out, { recursive: true });
  const partial = (file: string) => path.join(out, `${file}.partial`);
  const arrived: Date[] = [];
  try {
    for (const l of LISTS) {
      log(`[desktop] downloading ${l.url}`);
      await downloadList(l.url, partial(l.file));
      arrived.push(new Date());
    }
  } catch (e) {
    for (const l of LISTS) fs.rmSync(partial(l.file), { force: true });
    throw e;
  }
  LISTS.forEach((l, i) => {
    const file = path.join(out, l.file);
    fs.renameSync(partial(l.file), file);
    writeDownloadTime(file, arrived[i]);
  });
  return "downloaded";
}

/** The window's icon, `career-map.ico` copied as it is, and the tray icons made from it, in `icons/`. */
// @spec DESK-DIST-PKG-015, DESK-DIST-PKG-016
export function writeIcons(repo: string, out: string): void {
  const icons = path.join(out, "icons");
  fs.mkdirSync(icons, { recursive: true });
  const mark = fs.readFileSync(path.join(repo, "assets", "career-map.ico"));
  fs.writeFileSync(path.join(icons, "career-map.ico"), mark);
  for (const [name, bytes] of Object.entries(trayIcons(mark))) fs.writeFileSync(path.join(icons, `${name}.ico`), bytes);
}

/** The output's own `package.json`, so `electron <out>` runs `main.cjs`. */
// @spec DESK-DIST-DEV-001
export function writeAppManifest(out: string, version: string): void {
  const manifest = { name: "msfs-career-map", productName: "MSFS Career Map", version, private: true, type: "commonjs", main: "main.cjs" };
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** Electron on the build output in test mode on the repository's `.desktop-dev`, without `ELECTRON_RUN_AS_NODE`. */
// @spec DESK-DIST-DEV-001, DESK-DIST-DEV-005
export function electronCommand(
  repo: string,
  electronPath: string,
  env: Readonly<Record<string, string | undefined>>,
): { command: string; args: string[]; env: Record<string, string> } {
  const kept: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && key.toUpperCase() !== "ELECTRON_RUN_AS_NODE") kept[key] = value;
  }
  return {
    command: electronPath,
    args: [path.join(repo, "build", "desktop"), `--test-data=${path.join(repo, ".desktop-dev")}`],
    env: kept,
  };
}

const runDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (runDirectly) await buildDesktop(buildOptions(process.argv.slice(2)));
