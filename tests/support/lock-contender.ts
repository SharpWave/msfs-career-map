/**
 * One of two processes taking over the same stale data-folder locks at the same moments
 * (`lockContenders` in server-process.ts starts them). For each folder it answers `/api/status` as
 * a live server on that folder, on a port of its own, so the other contender judges a lock it took
 * as live. Once those listen it writes `ready`, and waits for a line on stdin naming `firstAt`, the
 * same wall-clock moment for both. At `firstAt + i * spacingMs` it takes folder i's lock, and keeps
 * it. Once every folder is done, and the other contender has had time to finish too, it writes one
 * JSON line, a `ContenderResult` per folder, and exits.
 *
 * Argument: one JSON object `{folders: string[], spacingMs: number}`. Free of test-runner imports:
 * it runs in a process of its own.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import { takeLock } from "../../src/server/lock.ts";

export interface ContenderResult {
  pid: number;
  /** Whether this process took the lock. */
  got: boolean;
  /** When it did not: the error's message. */
  err?: string;
  /** How late the attempt began after its moment, ms; a contender that started too late cannot race. */
  lateMs: number;
}

const { folders, spacingMs } = JSON.parse(process.argv[2]) as { folders: string[]; spacingMs: number };

const servers = await Promise.all(
  folders.map(
    (folder) =>
      new Promise<http.Server>((resolve) => {
        const srv = http.createServer((_req, res) => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true, app: "msfs-career-map", pid: process.pid, dataFolder: folder, startup: "done", ready: true }));
        });
        srv.listen(0, "127.0.0.1", () => resolve(srv));
      }),
  ),
);

process.stdout.write("ready\n");
const firstAt = await new Promise<number>((resolve) => {
  let line = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (d: string) => {
    line += d;
    if (line.includes("\n")) resolve(Number(line.trim()));
  });
});

const results: ContenderResult[] = [];
for (let i = 0; i < folders.length; i++) {
  const at = firstAt + i * spacingMs;
  // Sleep until just before the moment, so this process still answers the other's status requests,
  // then spin, to line the two contenders up as closely as the clock allows.
  const sleep = at - Date.now() - 15;
  if (sleep > 0) await new Promise((r) => setTimeout(r, sleep));
  while (Date.now() < at) {
    /* waiting for the moment */
  }
  const lateMs = Date.now() - at;
  const port = (servers[i].address() as AddressInfo).port;
  try {
    await takeLock(folders[i], { pid: process.pid, port });
    results.push({ pid: process.pid, got: true, lateMs });
  } catch (e) {
    results.push({ pid: process.pid, got: false, err: e instanceof Error ? e.message : String(e), lateMs });
  }
}

// Stay live while the other contender may still be judging the last lock taken.
const end = firstAt + folders.length * spacingMs + 1500;
await new Promise((r) => setTimeout(r, Math.max(0, end - Date.now())));
process.stdout.write(`${JSON.stringify(results)}\n`);
for (const srv of servers) {
  srv.closeAllConnections();
  srv.close();
}
process.stdin.destroy();
