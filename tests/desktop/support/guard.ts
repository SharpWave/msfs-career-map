/**
 * The `desktop` project's setup file (DESK-SHELL-TEST-001; m2 contract §18.1). The desktop shell's
 * unit tests run in Node without Electron, so every way the shell could reach the real machine is
 * replaced here before any test file loads:
 * - `child_process`, `net`, `http`, `https`, `dgram` and `electron` (either spelling, `node:x` or
 *   `x`) are mocked: every export, the default export's properties included, is a guarded
 *   stand-in that records `<module>.<name>` and throws when called, constructed or read for a
 *   string key. Symbol-keyed reads, `then` and `__esModule` give undefined and record nothing, so
 *   importing a module that holds such exports works and only using one fails.
 * - `process.kill` passes signal 0 (a look) and refuses anything else.
 * - `fetch` is refused for every origin, loopback included (APP-RUN-014's guard).
 * - `LOCALAPPDATA`, `APPDATA` and `USERPROFILE` point into a decoy folder of the run's temp folder.
 * After each test, a recorded hit or a refused request fails it.
 *
 * Nothing here imports from `src/desktop/`: it loads before any shell module exists.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, inject, vi } from "vitest";
import { installFetchGuard, resetAnswers, takeRefused } from "../../support/fetch-guard.ts";

interface GuardState {
  hits: string[];
  modules: Map<string, object>;
  standIns: Map<string, unknown>;
  decoy: string | null;
  killWrapped: boolean;
}

// Hoisted above the imports with the vi.mock calls below, so it may use nothing imported. The
// state lives on globalThis so that a test importing this file sees the one the mocks record in.
const guard = vi.hoisted(() => {
  const g = globalThis as { __desktopGuard?: GuardState };
  const state: GuardState = (g.__desktopGuard ??= {
    hits: [],
    modules: new Map(),
    standIns: new Map(),
    decoy: null,
    killWrapped: false,
  });
  const QUIET = new Set<PropertyKey>(["then", "__esModule"]);
  const quiet = (key: PropertyKey) => typeof key === "symbol" || QUIET.has(key);

  function refuse(name: string): never {
    state.hits.push(name);
    throw new Error(`desktop tests may not reach ${name}`);
  }

  /** A function-shaped stand-in: calling it, `new` on it or reading a string key records and throws. */
  function standIn(name: string): unknown {
    let s = state.standIns.get(name);
    if (!s) {
      s = new Proxy(function guarded() {}, {
        apply: () => refuse(name),
        construct: () => refuse(name),
        get: (_target, key) => (quiet(key) ? undefined : refuse(`${name}.${String(key)}`)),
      });
      state.standIns.set(name, s);
    }
    return s;
  }

  /** The mocked module `name` (bare, e.g. "child_process"); `node:x` and `x` share one. */
  function guardedModule(name: string): object {
    const known = state.modules.get(name);
    if (known) return known;
    const exportOf = (key: string) => standIn(`${name}.${key}`);
    const defaultExport = new Proxy(
      {},
      {
        get: (_target, key) => (quiet(key) ? undefined : exportOf(String(key))),
        has: () => true,
      },
    );
    const target: Record<string, unknown> = { default: defaultExport };
    // The real export names where Node has the module built in (electron has none to list).
    const getBuiltin = (process as { getBuiltinModule?: (id: string) => object | undefined }).getBuiltinModule;
    const real = name === "electron" ? undefined : getBuiltin?.call(process, `node:${name}`);
    for (const key of Object.keys(real ?? {})) if (key !== "default") target[key] = exportOf(key);
    const mod = new Proxy(target, {
      get: (t, key) => {
        if (quiet(key)) return undefined;
        const k = String(key);
        return k in t ? t[k] : exportOf(k);
      },
      has: () => true,
    });
    state.modules.set(name, mod);
    return mod;
  }

  return { state, guardedModule };
});

vi.mock("node:child_process", () => guard.guardedModule("child_process"));
vi.mock("child_process", () => guard.guardedModule("child_process"));
vi.mock("node:net", () => guard.guardedModule("net"));
vi.mock("net", () => guard.guardedModule("net"));
vi.mock("node:http", () => guard.guardedModule("http"));
vi.mock("http", () => guard.guardedModule("http"));
vi.mock("node:https", () => guard.guardedModule("https"));
vi.mock("https", () => guard.guardedModule("https"));
vi.mock("node:dgram", () => guard.guardedModule("dgram"));
vi.mock("dgram", () => guard.guardedModule("dgram"));
vi.mock("electron", () => guard.guardedModule("electron"));

/** The hits recorded since the last call, cleared (for the guard's own test). */
export function takeGuardHits(): string[] {
  return guard.state.hits.splice(0, guard.state.hits.length);
}

/** The decoy folder holding Local, Roaming and Profile. */
export function decoyFolder(): string {
  if (!guard.state.decoy) throw new Error("the desktop guard has not set up its decoy folder");
  return guard.state.decoy;
}

// process.kill: a signal-0 look passes; ending a process never does.
if (!guard.state.killWrapped) {
  guard.state.killWrapped = true;
  const realKill = process.kill.bind(process);
  process.kill = ((pid: number, signal?: string | number) => {
    if (signal === 0) return realKill(pid, 0);
    const name = `process.kill(${pid})`;
    guard.state.hits.push(name);
    throw new Error(`desktop tests may not reach ${name}`);
  }) as typeof process.kill;
}

// No outside request, loopback included: nothing is allowed through.
installFetchGuard();

// Windows' per-account folders point into a decoy, so a stray path built from them lands in the
// run's temp folder, never the pilot's own.
if (!guard.state.decoy) {
  const decoy = fs.mkdtempSync(path.join(inject("runDir"), "desktop-decoy-"));
  for (const [variable, folder] of [
    ["LOCALAPPDATA", "Local"],
    ["APPDATA", "Roaming"],
    ["USERPROFILE", "Profile"],
  ] as const) {
    const p = path.join(decoy, folder);
    fs.mkdirSync(p, { recursive: true });
    process.env[variable] = p;
  }
  guard.state.decoy = decoy;
}

afterEach(() => {
  resetAnswers();
  const hits = takeGuardHits();
  const refused = takeRefused();
  const problems: string[] = [];
  if (hits.length > 0) problems.push(`the test reached ${hits.join(", ")}`);
  if (refused.length > 0) {
    problems.push(`outside request(s) refused: ${refused.join(", ")} — answer them with answerFetch()`);
  }
  if (problems.length > 0) throw new Error(problems.join("; "));
});
