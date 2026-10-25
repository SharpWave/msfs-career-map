/**
 * The sim-fake tool's arguments (parseSimFakeArgs): the two airports are the first two arguments
 * that are neither options nor option values, wherever they come (LIVE-TOOL-003), and the samples
 * go to the server `--base` names, by default http://127.0.0.1:3080 (LIVE-TOOL-005).
 *
 * The bases given here are only parsed: no test reaches a server.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseSimFakeArgs, type SimFakeArgs } from "../../scripts/sim-fake-args.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const DEFAULTS: Omit<SimFakeArgs, "from" | "to"> = {
  base: "http://127.0.0.1:3080",
  speed: 30,
  cruise: 150,
  alt: 6500,
  title: "Fake Aircraft",
  livery: "",
  atc: "N000FK",
  fpm: 180,
  g: 1.4,
  touchAndGo: false,
  startAirborne: false,
};

describe("the sim-fake tool's arguments", () => {
  // @spec LIVE-TOOL-003, LIVE-TOOL-005
  it("takes the two airports and every default when given only the airports", () => {
    expect(parseSimFakeArgs(["KBOS", "KPVD"])).toEqual({ from: "KBOS", to: "KPVD", ...DEFAULTS });
  });

  // @spec LIVE-TOOL-003, LIVE-TOOL-005
  it("finds the airports after --base and its value", () => {
    expect(parseSimFakeArgs(["--base", "http://127.0.0.1:4280", "KBOS", "KPVD"])).toEqual({
      ...DEFAULTS,
      from: "KBOS",
      to: "KPVD",
      base: "http://127.0.0.1:4280",
    });
  });

  // @spec LIVE-TOOL-003
  it("finds the airports on either side of an option with its value and before a flag", () => {
    expect(parseSimFakeArgs(["KBOS", "--speed", "60", "KPVD", "--touch-and-go"])).toEqual({
      ...DEFAULTS,
      from: "KBOS",
      to: "KPVD",
      speed: 60,
      touchAndGo: true,
    });
  });

  // @spec LIVE-TOOL-003
  it("finds the airports after a flag, which takes no value", () => {
    expect(parseSimFakeArgs(["--touch-and-go", "KBOS", "KPVD"])).toEqual({ ...DEFAULTS, from: "KBOS", to: "KPVD", touchAndGo: true });
    expect(parseSimFakeArgs(["--start-airborne", "KBOS", "--touch-and-go", "KPVD"])).toEqual({
      ...DEFAULTS,
      from: "KBOS",
      to: "KPVD",
      touchAndGo: true,
      startAirborne: true,
    });
  });

  // @spec LIVE-TOOL-003, LIVE-TOOL-005
  it("reads every option given as --name value", () => {
    const args = [
      "--speed", "60", "--cruise", "120", "--alt", "4500", "--title", "Cessna 172 Skyhawk", "--livery", "Red Tail",
      "--atc", "N123AB", "--base", "http://127.0.0.1:4280", "--fpm", "320", "--g", "2.1", "KHYA", "KACK",
    ];
    expect(parseSimFakeArgs(args)).toEqual({
      from: "KHYA",
      to: "KACK",
      base: "http://127.0.0.1:4280",
      speed: 60,
      cruise: 120,
      alt: 4500,
      title: "Cessna 172 Skyhawk",
      livery: "Red Tail",
      atc: "N123AB",
      fpm: 320,
      g: 2.1,
      touchAndGo: false,
      startAirborne: false,
    });
  });

  // @spec LIVE-TOOL-003, LIVE-TOOL-005
  it("reads every option given as --name=value, and finds the airports among them", () => {
    const args = [
      "--speed=60", "KHYA", "--cruise=120", "--alt=4500", "--title=Cessna 172 Skyhawk", "--livery=Red Tail", "--atc=N123AB",
      "--base=http://127.0.0.1:4280", "--fpm=320", "KACK", "--g=2.1", "--touch-and-go",
    ];
    expect(parseSimFakeArgs(args)).toEqual({
      from: "KHYA",
      to: "KACK",
      base: "http://127.0.0.1:4280",
      speed: 60,
      cruise: 120,
      alt: 4500,
      title: "Cessna 172 Skyhawk",
      livery: "Red Tail",
      atc: "N123AB",
      fpm: 320,
      g: 2.1,
      touchAndGo: true,
      startAirborne: false,
    });
  });

  // @spec LIVE-TOOL-003
  it("takes the livery for the registration when no --atc is given", () => {
    expect(parseSimFakeArgs(["KBOS", "KPVD", "--livery", "N6229P"])).toMatchObject({ livery: "N6229P", atc: "N6229P" });
    expect(parseSimFakeArgs(["KBOS", "KPVD", "--livery=N6229P", "--atc=N1TP"])).toMatchObject({ livery: "N6229P", atc: "N1TP" });
  });

  // @spec LIVE-TOOL-005
  it("removes a trailing / from --base, in either form", () => {
    expect(parseSimFakeArgs(["--base", "http://127.0.0.1:4280/", "KBOS", "KPVD"]).base).toBe("http://127.0.0.1:4280");
    expect(parseSimFakeArgs(["KBOS", "KPVD", "--base=http://127.0.0.1:4280/"]).base).toBe("http://127.0.0.1:4280");
  });

  // @spec LIVE-TOOL-003
  it("gives from and to as null when they are missing, never taking an option's value for an airport", () => {
    expect(parseSimFakeArgs([])).toEqual({ ...DEFAULTS, from: null, to: null });
    expect(parseSimFakeArgs(["KBOS"])).toEqual({ ...DEFAULTS, from: "KBOS", to: null });
    expect(parseSimFakeArgs(["--base", "http://127.0.0.1:4280", "--speed", "60", "--touch-and-go"])).toEqual({
      ...DEFAULTS,
      from: null,
      to: null,
      base: "http://127.0.0.1:4280",
      speed: 60,
      touchAndGo: true,
    });
    expect(parseSimFakeArgs(["--title", "KBOS", "KPVD"])).toEqual({ ...DEFAULTS, from: "KPVD", to: null, title: "KBOS" });
  });
});

describe("the sim-fake tool", () => {
  const source = readFileSync(path.join(REPO, "scripts", "sim-fake.ts"), "utf8");
  /** The file's header: its first doc comment. */
  const header = source.match(/\/\*\*[\s\S]*?\*\//)?.[0] ?? "";

  // @spec LIVE-TOOL-003, LIVE-TOOL-005
  it("reads its arguments with parseSimFakeArgs, and names no http://localhost URL anywhere (contract §15)", () => {
    expect(source).toMatch(/import\s*\{[^}]*\bparseSimFakeArgs\b[^}]*\}\s*from\s*["']\.\/sim-fake-args(\.ts)?["']/);
    expect(source).toMatch(/\bparseSimFakeArgs\(/);
    expect(source).not.toContain("http://localhost");
  });

  // §15: the header documents one way to start the server it feeds, --sim=fake, and does not
  // mention TRACKER_FAKE at all (which a copy run from source still honours without --sim).
  // @spec LIVE-TOOL-005
  it("names in its header a server started with --sim=fake and --base http://127.0.0.1:<port>, and no TRACKER_FAKE", () => {
    expect(header).toContain("--sim=fake");
    expect(header).toMatch(/--base http:\/\/127\.0\.0\.1:/);
    expect(header).not.toContain("TRACKER_FAKE");
  });
});
