/**
 * Loaded into a launched server's own process (`--import`, after tsx and server-guard.ts) when a
 * test sets `act` (server-process.ts). Once the server writes a line matching TEST_SERVER_ACT_ON
 * (default `\[server\] ready`) to its stdout, it acts once, on the next turn of the event loop: it
 * emits the stop signal named by TEST_SERVER_ACT in that process, or throws an error, or rejects a
 * promise, outside the request handlers. On Windows a test cannot deliver these any other way:
 * killing a process with a signal ends it outright, and SIGBREAK and SIGHUP cannot be sent at all.
 *
 * - For `uncaught` and `rejection` it first adds a listener of its own, which does nothing, for
 *   both `uncaughtException` and `unhandledRejection`. Those turn off Node's own handling (write
 *   the stack, exit 1), so only the server's own handlers can write the error and end the process:
 *   a server without them keeps running, and the test fails (APP-SRV-020).
 * - After emitting a signal it writes `[server-preload] emitted <signal>` to stdout. A server's
 *   stop handler starts its shutdown inside the emit, writing `[server] shutting down` to stdout
 *   first, so on that one stream a handler's line always comes before this one.
 */
const ACTS = ["SIGINT", "SIGBREAK", "SIGHUP", "SIGTERM", "uncaught", "rejection"] as const;
type Act = (typeof ACTS)[number];

const EMITTED_PREFIX = "[server-preload] emitted ";
const write = process.stdout.write.bind(process.stdout) as (...a: unknown[]) => boolean;

const act = process.env.TEST_SERVER_ACT;
if (act) {
  if (!(ACTS as readonly string[]).includes(act)) {
    throw new Error(`server-preload: TEST_SERVER_ACT=${act} is not one of ${ACTS.join(", ")}`);
  }
  if (act === "uncaught" || act === "rejection") {
    process.on("uncaughtException", () => {});
    process.on("unhandledRejection", () => {});
  }
  const on = new RegExp(process.env.TEST_SERVER_ACT_ON || "\\[server\\] ready");
  let acted = false;
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    const r = write(chunk, ...rest);
    if (!acted && on.test(String(chunk))) {
      acted = true;
      setImmediate(() => perform(act as Act));
    }
    return r;
  }) as typeof process.stdout.write;
}

function perform(a: Act): void {
  if (a === "uncaught") {
    setTimeout(() => {
      throw new Error("test: an error outside the request handlers");
    });
  } else if (a === "rejection") {
    void Promise.reject(new Error("test: a rejection outside the request handlers"));
  } else {
    process.emit(a, a);
    write(`${EMITTED_PREFIX}${a}\n`);
  }
}
