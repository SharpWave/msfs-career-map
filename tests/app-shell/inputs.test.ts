/**
 * The server's inputs (src/server/inputs.ts): the bundled form takes every input from its start-up
 * arguments alone (APP-SRV-006, LIVE-LINK-012); a copy run from source takes what its arguments
 * leave out from its defaults (APP-SRV-007, LIVE-LINK-013); the test servers take theirs as a copy
 * run from source given no arguments (APP-SRV-023). `readInputs` is pure and creates nothing, so
 * paths that name the repository's own `data/` are only compared, never opened.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, inject, it, vi } from "vitest";
import { ROOT } from "../../src/server/locations.ts";
import { InputError, currentInputs, readInputs, type ServerInputs } from "../../src/server/inputs.ts";
import { APP_NAME, VERSION } from "../../src/server/version.ts";

const RUN_DIR = inject("runDir");
// Never created: readInputs only resolves these.
const DATA = path.join(RUN_DIR, "inputs", "data");
const PROGRAM = path.join(RUN_DIR, "inputs", "program");
const BACKUPS = path.join(RUN_DIR, "inputs", "backups");

const isInside = (child: string, parent: string) => {
  const rel = path.relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

/** The thrown InputError; fails when readInputs returns or throws anything else. */
function refusal(read: () => unknown): InputError {
  try {
    read();
  } catch (e) {
    if (e instanceof InputError) return e;
    throw e;
  }
  throw new Error("readInputs did not throw");
}

/** Every argument the bundled form requires, in the order it checks them. */
const REQUIRED = ["data", "program", "port", "backups", "sim", "airport-downloads"] as const;
const MISSING: Record<(typeof REQUIRED)[number], string> = {
  data: "Cannot start: no --data given",
  program: "Cannot start: no --program given",
  port: "Cannot start: no --port given",
  backups: "Cannot start: no --backups or --backups-documents given",
  sim: "Cannot start: no --sim given",
  "airport-downloads": "Cannot start: no --airport-downloads given",
};
const VALUE: Record<(typeof REQUIRED)[number], string> = {
  data: DATA,
  program: PROGRAM,
  port: "4321",
  backups: BACKUPS,
  sim: "off",
  "airport-downloads": "off",
};
/** The bundled form's full argument list, less the names given. */
const bundledArgs = (...without: string[]) =>
  REQUIRED.filter((n) => !without.includes(n)).map((n) => `--${n}=${VALUE[n]}`);
const bundled = (args: string[], env: Record<string, string | undefined> = {}) => readInputs("bundled", args, env);
const source = (args: string[], env: Record<string, string | undefined> = {}) => readInputs("source", args, env);

const BUNDLED: ServerInputs = {
  form: "bundled",
  dataFolder: path.resolve(DATA),
  dbPath: path.join(path.resolve(DATA), "career.db"),
  programFolder: path.resolve(PROGRAM),
  pageFolder: path.join(path.resolve(PROGRAM), "page"),
  port: 4321,
  backups: { kind: "folder", folder: path.resolve(BACKUPS) },
  sim: "off",
  simHost: null,
  simPort: null,
  airportDownloads: false,
  offer: null,
  freshRun: false,
};

/** Every variable a copy run from source reads, pointed at the repository's real logbook and port. */
const SOURCE_ENV = {
  CAREER_DB: path.join(ROOT, "data", "career.db"),
  PORT: "3080",
  TRACKER: "0",
  TRACKER_FAKE: "1",
  SIMCONNECT_HOST: "192.168.1.20",
  SIMCONNECT_PORT: "500",
};

/** Every argument that takes a value. */
const VALUE_NAMES = ["data", "program", "port", "backups", "backups-documents", "sim", "airport-downloads", "offer"];

describe("the bundled form's inputs", () => {
  // @spec APP-SRV-006, LIVE-LINK-012, APP-DATA-001
  it("reads every input from its arguments", () => {
    expect(bundled(bundledArgs())).toEqual(BUNDLED);
    expect(
      bundled([
        ...bundledArgs("sim", "airport-downloads", "port"),
        "--port=0",
        "--sim=fake",
        "--airport-downloads=on",
        `--offer=${path.join(RUN_DIR, "offered", "logbook.db")}`,
        "--fresh-run",
      ]),
    ).toEqual({
      ...BUNDLED,
      port: 0,
      sim: "fake",
      airportDownloads: true,
      offer: path.join(RUN_DIR, "offered", "logbook.db"),
      freshRun: true,
    });
    expect(bundled([...bundledArgs("sim", "port"), "--sim=link", "--port=65535"])).toMatchObject({ sim: "link", port: 65535 });
    expect(bundled([...bundledArgs("sim"), "--sim=off"]).sim).toBe("off");
  });

  // @spec APP-SRV-006
  it("resolves relative paths and splits a value only at its first =", () => {
    const got = bundled([
      ...bundledArgs("data", "program"),
      "--data=rel/data",
      "--program=rel/program",
      "--offer=rel/a=b.db",
    ]);
    expect(got.dataFolder).toBe(path.resolve("rel/data"));
    expect(got.dbPath).toBe(path.join(path.resolve("rel/data"), "career.db"));
    expect(got.programFolder).toBe(path.resolve("rel/program"));
    expect(got.pageFolder).toBe(path.join(path.resolve("rel/program"), "page"));
    expect(got.offer).toBe(path.resolve("rel/a=b.db"));
  });

  // @spec APP-SRV-006
  it("writes the first missing argument's line, in the order data, program, port, backups, sim, airport downloads", () => {
    REQUIRED.forEach((name, i) => {
      // That one alone missing.
      expect(refusal(() => bundled(bundledArgs(name))).message, `${name} alone`).toBe(MISSING[name]);
      // That one and every later one missing: the first is named.
      expect(refusal(() => bundled(bundledArgs(...REQUIRED.slice(i)))).message, `from ${name} on`).toBe(MISSING[name]);
    });
    expect(refusal(() => bundled([])).message).toBe("Cannot start: no --data given");
  });

  // @spec APP-SRV-006, LIVE-LINK-012
  it("reads no environment variable at all, falling back on none for a missing argument", () => {
    expect(bundled(bundledArgs(), SOURCE_ENV)).toEqual(BUNDLED);
    expect(bundled([...bundledArgs("sim"), "--sim=link"], SOURCE_ENV)).toEqual({ ...BUNDLED, sim: "link" });
    expect(refusal(() => bundled(bundledArgs("data"), SOURCE_ENV)).message).toBe("Cannot start: no --data given");
    expect(refusal(() => bundled(bundledArgs("port"), SOURCE_ENV)).message).toBe("Cannot start: no --port given");
    expect(refusal(() => bundled(bundledArgs("sim"), SOURCE_ENV)).message).toBe("Cannot start: no --sim given");
    expect(refusal(() => bundled(bundledArgs("sim"), { TRACKER_FAKE: "1" })).message).toBe("Cannot start: no --sim given");
    expect(refusal(() => bundled(bundledArgs("backups"), SOURCE_ENV)).message).toBe(
      "Cannot start: no --backups or --backups-documents given",
    );
    expect(refusal(() => bundled(bundledArgs("port"), { PORT: "not a port" })).message).toBe("Cannot start: no --port given");
  });

  // @spec APP-SRV-008
  it("puts no path under the repository unless an argument names it", () => {
    const got = bundled([...bundledArgs(), `--offer=${path.join(RUN_DIR, "offered.db")}`], SOURCE_ENV);
    const paths = [got.dataFolder, got.dbPath, got.programFolder!, got.pageFolder, got.offer!];
    if (got.backups.kind === "folder") paths.push(got.backups.folder);
    expect(got.backups.kind).toBe("folder");
    for (const p of paths) {
      expect(isInside(p, ROOT), p).toBe(false);
      expect(isInside(p, RUN_DIR), p).toBe(true);
    }
  });

  // @spec APP-SRV-006
  it("takes --backups or --backups-documents, each alone, and refuses both", () => {
    expect(bundled(bundledArgs()).backups).toEqual({ kind: "folder", folder: path.resolve(BACKUPS) });
    expect(bundled([...bundledArgs("backups"), "--backups=rel/backups"]).backups).toEqual({
      kind: "folder",
      folder: path.resolve("rel/backups"),
    });
    // Kept as given: Documents is not looked up here.
    expect(bundled([...bundledArgs("backups"), "--backups-documents=Logbooks=Old\\Backups"]).backups).toEqual({
      kind: "documents",
      path: "Logbooks=Old\\Backups",
    });
    expect(refusal(() => bundled([...bundledArgs(), "--backups-documents=MSFS Career Map"])).message).toBe(
      "Cannot start: give --backups or --backups-documents, not both",
    );
    expect(
      refusal(() => bundled([...bundledArgs("backups"), "--backups-documents=MSFS Career Map", `--backups=${BACKUPS}`])).message,
    ).toBe("Cannot start: give --backups or --backups-documents, not both");
  });

  // @spec APP-SRV-006, LIVE-LINK-012
  it("refuses each invalid value with its own line", () => {
    for (const v of ["abc", "65536", "-1", "1.5", "3080x"]) {
      expect(refusal(() => bundled([...bundledArgs("port"), `--port=${v}`])).message, v).toBe(
        `Cannot start: --port=${v} is not a port number`,
      );
    }
    for (const v of ["on", "sim", "true", "fake,off"]) {
      expect(refusal(() => bundled([...bundledArgs("sim"), `--sim=${v}`])).message, v).toBe(
        `Cannot start: --sim=${v} is not link, fake or off`,
      );
    }
    for (const v of ["yes", "1", "true", "offline"]) {
      expect(refusal(() => bundled([...bundledArgs("airport-downloads"), `--airport-downloads=${v}`])).message, v).toBe(
        `Cannot start: --airport-downloads=${v} is not on or off`,
      );
    }
  });

  // @spec APP-SRV-006
  it("refuses an argument that takes a value given none or an empty one", () => {
    // The ones the plan names: --sim alone, and --data=, --program= and --backups=.
    expect(refusal(() => bundled([...bundledArgs("sim"), "--sim"])).message).toBe("Cannot start: --sim needs a value");
    expect(refusal(() => bundled([...bundledArgs("data"), "--data="])).message).toBe("Cannot start: --data needs a value");
    expect(refusal(() => bundled([...bundledArgs("program"), "--program="])).message).toBe("Cannot start: --program needs a value");
    expect(refusal(() => bundled([...bundledArgs("backups"), "--backups="])).message).toBe("Cannot start: --backups needs a value");
    // And every other value-taking name, in both forms.
    for (const name of VALUE_NAMES) {
      const others = name === "backups-documents" ? bundledArgs("backups") : bundledArgs(name);
      for (const arg of [`--${name}`, `--${name}=`]) {
        expect(refusal(() => bundled([...others, arg])).message, arg).toBe(`Cannot start: --${name} needs a value`);
      }
    }
  });

  // @spec APP-SRV-006
  it("lets the last of a repeated argument win and ignores unknown ones", () => {
    const other = path.join(RUN_DIR, "inputs", "other");
    expect(
      bundled([
        ...bundledArgs(),
        "--port=1111",
        "--port=2222",
        "--sim=fake",
        "--sim=off",
        `--data=${other}`,
        "--airport-downloads=on",
      ]),
    ).toEqual({ ...BUNDLED, port: 2222, sim: "off", dataFolder: other, dbPath: path.join(other, "career.db"), airportDownloads: true });
    expect(
      bundled([
        "serve",
        path.join(ROOT, "src", "server", "bundled.ts"),
        ...bundledArgs(),
        "--watch",
        "--inspect=9229",
        "--no-warnings=ExperimentalWarning",
        "--data-folder=elsewhere",
        "--simconnect-host=10.0.0.5",
        "-p",
        "--",
      ]),
    ).toEqual(BUNDLED);
  });

  // @spec APP-SRV-006
  it("counts --fresh-run as given whatever value comes with it", () => {
    expect(bundled(bundledArgs()).freshRun).toBe(false);
    expect(bundled([...bundledArgs(), "--fresh-run"]).freshRun).toBe(true);
    expect(bundled([...bundledArgs(), "--fresh-run=no"]).freshRun).toBe(true);
    expect(bundled(["--fresh-run", ...bundledArgs()]).freshRun).toBe(true);
  });
});

describe("a copy run from source's inputs", () => {
  const DEFAULTS: ServerInputs = {
    form: "source",
    dataFolder: path.join(ROOT, "data"),
    dbPath: path.join(ROOT, "data", "career.db"),
    programFolder: null,
    pageFolder: path.join(ROOT, "dist"),
    port: 3080,
    backups: { kind: "folder", folder: path.join(ROOT, "data", "backups") },
    sim: "off",
    simHost: null,
    simPort: null,
    airportDownloads: true,
    offer: null,
    freshRun: false,
  };

  // @spec APP-SRV-007, APP-DATA-001, LIVE-LINK-013
  it("takes every default with no arguments and an empty environment", () => {
    expect(source([], {})).toEqual(DEFAULTS);
    // tsx's own arguments and positional ones change nothing.
    expect(source([path.join(ROOT, "src", "server", "index.ts"), "--watch", "--no-warnings=ExperimentalWarning"], {})).toEqual(DEFAULTS);
  });

  // @spec APP-SRV-007, APP-DATA-001
  it("takes the database and its folder from CAREER_DB, whatever the file is called", () => {
    const db = path.join(RUN_DIR, "elsewhere", "logbook.sqlite");
    expect(source([], { CAREER_DB: db })).toEqual({
      ...DEFAULTS,
      dataFolder: path.join(RUN_DIR, "elsewhere"),
      dbPath: db,
      backups: { kind: "folder", folder: path.join(RUN_DIR, "elsewhere", "backups") },
    });
    expect(source([], { CAREER_DB: "rel/logbook.sqlite" }).dbPath).toBe(path.resolve("rel/logbook.sqlite"));
  });

  // @spec APP-SRV-007, APP-DATA-001
  it("lets --data win over CAREER_DB, and takes the port from PORT", () => {
    expect(source([`--data=${DATA}`], { CAREER_DB: path.join(RUN_DIR, "elsewhere", "logbook.sqlite"), PORT: "4567" })).toEqual({
      ...DEFAULTS,
      dataFolder: path.resolve(DATA),
      dbPath: path.join(path.resolve(DATA), "career.db"),
      backups: { kind: "folder", folder: path.join(path.resolve(DATA), "backups") },
      port: 4567,
    });
    expect(source(["--port=5000"], { PORT: "4567" }).port).toBe(5000);
    expect(source([], { PORT: "0" }).port).toBe(0);
  });

  // @spec APP-SRV-007
  it("counts an empty CAREER_DB or PORT as unset", () => {
    expect(source([], { CAREER_DB: "", PORT: "", TRACKER_FAKE: "", SIMCONNECT_HOST: "", SIMCONNECT_PORT: "" })).toEqual(DEFAULTS);
  });

  // @spec APP-SRV-007
  it("refuses an empty or missing value rather than taking a default", () => {
    expect(refusal(() => source(["--data="], { CAREER_DB: path.join(RUN_DIR, "elsewhere", "logbook.sqlite") })).message).toBe(
      "Cannot start: --data needs a value",
    );
    expect(refusal(() => source(["--port="], { PORT: "4567" })).message).toBe("Cannot start: --port needs a value");
    expect(refusal(() => source(["--sim"], { TRACKER_FAKE: "1" })).message).toBe("Cannot start: --sim needs a value");
    for (const name of VALUE_NAMES) {
      for (const arg of [`--${name}`, `--${name}=`]) {
        expect(refusal(() => source([arg])).message, arg).toBe(`Cannot start: --${name} needs a value`);
      }
    }
  });

  // @spec APP-SRV-007
  it("refuses a bad port from --port or from PORT, naming where it came from", () => {
    expect(refusal(() => source(["--port=abc"])).message).toBe("Cannot start: --port=abc is not a port number");
    expect(refusal(() => source(["--port=70000"], { PORT: "4567" })).message).toBe("Cannot start: --port=70000 is not a port number");
    for (const v of ["abc", "65536", "-1", "1.5", "3080x"]) {
      expect(refusal(() => source([], { PORT: v })).message, v).toBe(`Cannot start: PORT=${v} is not a port number`);
    }
    // A good --port wins over a bad PORT.
    expect(source(["--port=4321"], { PORT: "abc" }).port).toBe(4321);
  });

  // @spec APP-SRV-007
  it("takes the page, backups, downloads, the logbook to offer and the fresh run from its arguments when given", () => {
    expect(
      source([
        `--program=${PROGRAM}`,
        "--backups-documents=MSFS Career Map\\Backups",
        "--airport-downloads=off",
        `--offer=${path.join(RUN_DIR, "offered.db")}`,
        "--fresh-run",
      ], {}),
    ).toEqual({
      ...DEFAULTS,
      programFolder: path.resolve(PROGRAM),
      pageFolder: path.join(path.resolve(PROGRAM), "page"),
      backups: { kind: "documents", path: "MSFS Career Map\\Backups" },
      airportDownloads: false,
      offer: path.join(RUN_DIR, "offered.db"),
      freshRun: true,
    });
    expect(source([`--backups=${BACKUPS}`]).backups).toEqual({ kind: "folder", folder: path.resolve(BACKUPS) });
    expect(refusal(() => source([`--backups=${BACKUPS}`, "--backups-documents=x"])).message).toBe(
      "Cannot start: give --backups or --backups-documents, not both",
    );
    expect(refusal(() => source(["--sim=on"])).message).toBe("Cannot start: --sim=on is not link, fake or off");
    expect(refusal(() => source(["--airport-downloads=yes"])).message).toBe("Cannot start: --airport-downloads=yes is not on or off");
  });

  // @spec LIVE-LINK-013
  it("takes the fake feed from TRACKER_FAKE=1 and lets --sim win over it", () => {
    expect(source([], { TRACKER_FAKE: "1" }).sim).toBe("fake");
    expect(source([], { TRACKER_FAKE: "true" }).sim).toBe("off");
    expect(source([], { TRACKER_FAKE: "0" }).sim).toBe("off");
    expect(source(["--sim=off"], { TRACKER_FAKE: "1" }).sim).toBe("off");
    expect(source(["--sim=link"], { TRACKER_FAKE: "1" }).sim).toBe("link");
    expect(source(["--sim=fake"], {}).sim).toBe("fake");
    expect(source(["--sim=link"], {}).sim).toBe("link");
    // TRACKER=0 means nothing any more.
    expect(source([], { TRACKER: "0" }).sim).toBe("off");
    expect(source([], { TRACKER: "0", TRACKER_FAKE: "1" }).sim).toBe("fake");
    expect(source(["--sim=link"], { TRACKER: "0" }).sim).toBe("link");
  });

  // @spec LIVE-LINK-013
  it("reads SIMCONNECT_HOST and SIMCONNECT_PORT only on the sim link", () => {
    const env = { SIMCONNECT_HOST: "  192.168.1.20 ", SIMCONNECT_PORT: "500" };
    expect(source(["--sim=link"], env)).toMatchObject({ sim: "link", simHost: "192.168.1.20", simPort: 500 });
    expect(source(["--sim=fake"], env)).toMatchObject({ sim: "fake", simHost: null, simPort: null });
    expect(source(["--sim=off"], env)).toMatchObject({ sim: "off", simHost: null, simPort: null });
    expect(source([], env)).toMatchObject({ sim: "off", simHost: null, simPort: null });
    expect(source([], { ...env, TRACKER_FAKE: "1" })).toMatchObject({ sim: "fake", simHost: null, simPort: null });
    // On the link: no host, or a port that is not one, is null.
    expect(source(["--sim=link"], {})).toMatchObject({ simHost: null, simPort: null });
    expect(source(["--sim=link"], { SIMCONNECT_PORT: "abc" }).simPort).toBeNull();
    expect(source(["--sim=link"], { SIMCONNECT_PORT: "70000" }).simPort).toBeNull();
    expect(source(["--sim=link"], { SIMCONNECT_PORT: "5x" }).simPort).toBeNull();
    expect(source(["--sim=link"], { SIMCONNECT_HOST: "my-sim-pc" })).toMatchObject({ simHost: "my-sim-pc", simPort: null });
  });
});

describe("the inputs in this test file", () => {
  // @spec APP-SRV-023, APP-DATA-001
  it("names CAREER_DB's folder, with the sim off and the backups inside the run folder", () => {
    const dbPath = path.resolve(process.env.CAREER_DB!);
    const dataFolder = path.dirname(dbPath);
    const got = currentInputs();
    expect(got).toMatchObject({
      form: "source",
      dataFolder,
      dbPath,
      programFolder: null,
      pageFolder: path.join(ROOT, "dist"),
      backups: { kind: "folder", folder: path.join(dataFolder, "backups") },
      sim: "off",
      simHost: null,
      simPort: null,
      offer: null,
      freshRun: false,
    });
    expect(isInside(dataFolder, RUN_DIR)).toBe(true);
    expect(got.backups.kind === "folder" && isInside(got.backups.folder, RUN_DIR)).toBe(true);
    // The fallback is the source form with no arguments; process.argv is never read.
    expect(got).toEqual(readInputs("source", [], process.env));
  });

  // @spec APP-SRV-023
  it("computes the inputs once and keeps them", () => {
    const first = currentInputs();
    const saved = { CAREER_DB: process.env.CAREER_DB, TRACKER_FAKE: process.env.TRACKER_FAKE };
    try {
      process.env.CAREER_DB = path.join(RUN_DIR, "elsewhere", "logbook.sqlite");
      process.env.TRACKER_FAKE = "1";
      expect(currentInputs()).toEqual(first);
      expect(currentInputs().sim).toBe("off");
    } finally {
      process.env.CAREER_DB = saved.CAREER_DB;
      if (saved.TRACKER_FAKE === undefined) delete process.env.TRACKER_FAKE;
      else process.env.TRACKER_FAKE = saved.TRACKER_FAKE;
    }
  });

  // @spec APP-SRV-008, APP-DATA-001
  it("has the database and its folders found through the inputs", async () => {
    const { DB_PATH, DATA_DIR, IMAGES_DIR, AIRPORTS_CSV, RUNWAYS_CSV } = await import("../../src/server/db.ts");
    const got = currentInputs();
    expect(DB_PATH).toBe(got.dbPath);
    expect(DATA_DIR).toBe(got.dataFolder);
    expect(IMAGES_DIR).toBe(path.join(got.dataFolder, "images"));
    expect(AIRPORTS_CSV).toBe(path.join(got.dataFolder, "airports.csv"));
    expect(RUNWAYS_CSV).toBe(path.join(got.dataFolder, "runways.csv"));
    expect(fs.statSync(IMAGES_DIR).isDirectory()).toBe(true);
  });

  // @spec APP-API-005
  it("takes the version from package.json", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { name: string; version: string };
    expect(VERSION).toBe(pkg.version);
    expect(APP_NAME).toBe("msfs-career-map");
  });
});

// Last in the file: it loads fresh copies of the modules. In this file CAREER_DB and currentInputs()
// name the same database, so only inputs set with useInputs show which one db.ts follows.
describe("the database the inputs name", () => {
  // @spec APP-SRV-008, APP-DATA-001
  it("is the one db.ts opens, with its folders beside it, whatever CAREER_DB says", async () => {
    const folder = fs.mkdtempSync(path.join(RUN_DIR, "inputs-db-"));
    vi.resetModules();
    try {
      const fresh = await import("../../src/server/inputs.ts");
      fresh.useInputs({ ...fresh.readInputs("source", [], process.env), dataFolder: folder, dbPath: path.join(folder, "career.db") });
      const { DB_PATH, DATA_DIR, IMAGES_DIR, AIRPORTS_CSV, RUNWAYS_CSV, db } = await import("../../src/server/db.ts");
      try {
        expect(DB_PATH).toBe(path.join(folder, "career.db"));
        expect(DATA_DIR).toBe(folder);
        expect(IMAGES_DIR).toBe(path.join(folder, "images"));
        expect(AIRPORTS_CSV).toBe(path.join(folder, "airports.csv"));
        expect(RUNWAYS_CSV).toBe(path.join(folder, "runways.csv"));
        expect(fs.existsSync(path.join(folder, "career.db"))).toBe(true);
        expect(path.dirname(path.resolve(process.env.CAREER_DB!))).not.toBe(folder);
      } finally {
        db.close();
      }
    } finally {
      vi.resetModules();
    }
  });

  // @spec APP-SRV-023, APP-SRV-008, APP-DATA-001
  it("loads with a PORT that is not a port number, the fallback taking the default port and CAREER_DB's database exactly", async () => {
    const saved = process.env.PORT;
    const dbPath = path.resolve(process.env.CAREER_DB!);
    vi.resetModules();
    try {
      process.env.PORT = "abc";
      const fresh = await import("../../src/server/inputs.ts");
      // A server's own start still refuses it.
      expect(() => fresh.readInputs("source", [], process.env)).toThrow(new fresh.InputError("Cannot start: PORT=abc is not a port number"));
      // db.ts, as `npm run import-airports` and the test servers load it, does not.
      const { DB_PATH, DATA_DIR, db } = await import("../../src/server/db.ts");
      try {
        expect(DB_PATH).toBe(dbPath);
        expect(DATA_DIR).toBe(path.dirname(dbPath));
        expect(fresh.currentInputs()).toEqual({ ...fresh.readInputs("source", [], { ...process.env, PORT: undefined }), port: 3080 });
        expect(fresh.currentInputs()).toMatchObject({ dbPath, dataFolder: path.dirname(dbPath), port: 3080, sim: "off" });
      } finally {
        db.close();
      }
    } finally {
      if (saved === undefined) delete process.env.PORT;
      else process.env.PORT = saved;
      vi.resetModules();
    }
  });
});
