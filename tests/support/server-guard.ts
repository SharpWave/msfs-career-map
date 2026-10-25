/**
 * Loaded into every server a test starts as a process (`--import`, after tsx; server-process.ts),
 * so that a server whose code is wrong still cannot reach what a test must never reach:
 * - `fetch` goes through only to 127.0.0.1, localhost or [::1], and never to a port in
 *   TEST_SERVER_RESERVED_PORTS: no download, weather, Wikipedia or SimBrief request leaves the PC,
 *   and the pilot's own server is never asked;
 * - `node:sqlite` opens a database only inside TEST_SERVER_RUN_DIR (or in memory), so the pilot's
 *   logbook in data/ or %LOCALAPPDATA% cannot be opened.
 * Each refusal is written to stderr as a `[test-guard] ` line, which launchServer's checks turn
 * into a failed test. Free of test-runner imports: it runs in the server's own process.
 *
 * The browser-test server (e2e-server.ts) uses `guardDatabases` alone, on its own data folder.
 */
import { createRequire, syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const GUARD_PREFIX = "[test-guard] ";

const report = (line: string) => {
  process.stderr.write(`${GUARD_PREFIX}${line}\n`);
};

const norm = (p: string) => {
  const r = path.resolve(p);
  return process.platform === "win32" ? r.toLowerCase() : r;
};

/** Whether `p` is `folder` or inside it, compared as Windows does. */
const within = (p: string, folder: string) => {
  const rel = path.relative(norm(folder), norm(p));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

/** Refuse every `fetch` but one to this PC's loopback addresses on a port that is not reserved. */
export function guardFetch(reserved: readonly number[]): void {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const raw = input instanceof Request ? input.url : String(input);
    let url: URL | null = null;
    try {
      url = new URL(raw);
    } catch {
      // Not an absolute URL: let fetch itself refuse it.
    }
    const loopback = url !== null && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    const port = url === null ? NaN : Number(url.port || (url.protocol === "https:" ? 443 : 80));
    if (url !== null && (!loopback || reserved.includes(port))) {
      report(`refused outside request: ${url.href}`);
      throw new TypeError(`test guard: outside request refused in a test server: ${url.href}`);
    }
    return real(input, init);
  }) as typeof fetch;
}

/** Refuse to open a database file anywhere but inside `allowed` (an in-memory database is fine). */
export function guardDatabases(allowed: string): void {
  const require = createRequire(import.meta.url);
  const sqlite = require("node:sqlite") as typeof import("node:sqlite");
  const Real = sqlite.DatabaseSync;
  class GuardedDatabaseSync extends Real {
    constructor(...args: ConstructorParameters<typeof Real>) {
      const file: unknown = args[0];
      const name =
        typeof file === "string" ? file : file instanceof URL ? fileURLToPath(file) : Buffer.isBuffer(file) ? file.toString("utf8") : String(file);
      // ":memory:" and "" (SQLite's private temporary database) are no file of the pilot's.
      if (name !== ":memory:" && name !== "" && !within(name, allowed)) {
        report(`refused to open the database ${name}, outside ${allowed}`);
        throw new Error(`test guard: refusing to open the database ${name}, outside ${allowed}`);
      }
      super(...args);
    }
  }
  (sqlite as { DatabaseSync: typeof Real }).DatabaseSync = GuardedDatabaseSync;
  // Modules that import { DatabaseSync } from "node:sqlite" from now on get the guarded class.
  syncBuiltinESMExports();
}

// As a preload: on whenever launchServer set the run folder.
const runDir = process.env.TEST_SERVER_RUN_DIR;
if (runDir) {
  const reserved = (process.env.TEST_SERVER_RESERVED_PORTS ?? "")
    .split(",")
    .filter(Boolean)
    .map(Number);
  guardFetch(reserved);
  guardDatabases(runDir);
}
