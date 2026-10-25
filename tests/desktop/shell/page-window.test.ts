/**
 * What the open window shows (src/desktop/page-window.ts; m2 contract §13.5), row by row of the
 * contract's table: the start screen until the server's start-up work is done, then the page
 * (DESK-SHELL-WIN-001), loaded fresh in every window opened (WIN-030); the failure screen while the
 * shell has given up (WIN-002), the page again once done after Try again (WIN-003); a loaded page
 * left in place while the server restarts (WIN-004); a failed main-frame load or a lost renderer
 * showing the start screen and loading the page again — 1 s later when the server is already
 * done — or the failure or quitting screen (WIN-020); a second renderer loss within 5 minutes
 * showing "The page stopped. …" for good (WIN-021); the quitting screen for a window opened while
 * quitting, a window showing the page left as it is (WIN-032); and the page loaded again after a
 * requested restart (DESK-SHELL-SRV-043).
 *
 * Time moves only through FakeClock.advance; the 5-minute window is read from the clock's now().
 */
import { describe, expect, it } from "vitest";
import { PageWindow, type ShellView } from "../../../src/desktop/page-window.ts";
import { screenUrl } from "../../../src/desktop/screens.ts";
import { FakeClock } from "../support/clock.ts";
import { screenOf } from "../support/fakes.ts";

/** A stand-in port: nothing listens on it. */
const PORT = 3280;
const PAGE = "http://127.0.0.1:3280/";
const STOPPED_LINE = "[window] The page stopped. Close this window and open it again from the tray.";

const STARTING: ShellView = { quitting: false, serverDone: false, givenUp: null };
const DONE: ShellView = { quitting: false, serverDone: true, givenUp: null };
const givenUp = (reason: string): ShellView => ({ quitting: false, serverDone: false, givenUp: reason });
const QUITTING: ShellView = { quitting: true, serverDone: false, givenUp: null };
const QUITTING_DONE: ShellView = { quitting: true, serverDone: true, givenUp: null };

function open(v: ShellView, clock = new FakeClock()) {
  const loads: string[] = [];
  const logs: string[] = [];
  const w = new PageWindow({ port: PORT, clock, load: (url) => loads.push(url), log: (line) => logs.push(line) }, v);
  /** What each load showed, in order. */
  const shown = () => loads.map((url) => screenOf(url, PORT));
  return { w, clock, loads, logs, shown };
}

/** A window that shows the page with the server done. */
function onThePage(clock = new FakeClock()) {
  const t = open(DONE, clock);
  expect(t.w.view()).toBe("page");
  return t;
}

describe("opening", () => {
  // @spec DESK-SHELL-WIN-001
  it("shows the start screen while the server's start-up work is not done", () => {
    const { w, loads } = open(STARTING);
    expect(w.view()).toBe("start");
    expect(loads).toEqual([screenUrl({ kind: "start" })]);
  });

  // @spec DESK-SHELL-WIN-001, DESK-SHELL-WIN-030
  it("loads the page at once when the start-up work is done", () => {
    const { w, loads } = open(DONE);
    expect(w.view()).toBe("page");
    expect(loads).toEqual([PAGE]);
  });

  // @spec DESK-SHELL-WIN-030
  it("loads the page fresh in every window opened again", () => {
    const clock = new FakeClock();
    const first = open(DONE, clock);
    const again = open(DONE, clock);
    expect(first.loads).toEqual([PAGE]);
    expect(again.loads).toEqual([PAGE]);
    expect(again.w.view()).toBe("page");
  });

  // @spec DESK-SHELL-WIN-002
  it("shows the failure screen with the reason while the shell has given up", () => {
    const reason = "Port 3280 is in use by another program";
    const { w, loads } = open(givenUp(reason));
    expect(w.view()).toBe("failure");
    expect(loads).toEqual([screenUrl({ kind: "failure", reason })]);
  });

  // @spec DESK-SHELL-WIN-032
  it("shows the quitting screen while quitting, whatever the server", () => {
    for (const v of [QUITTING, QUITTING_DONE, { quitting: true, serverDone: false, givenUp: "The server stopped responding" }]) {
      const { w, loads } = open(v);
      expect(w.view()).toBe("quitting");
      expect(loads).toEqual([screenUrl({ kind: "quitting" })]);
    }
  });

  // @spec DESK-SHELL-WIN-001
  it("loads nothing more until the shell changes", async () => {
    const { clock, loads } = open(STARTING);
    await clock.advance(60_000);
    expect(loads).toHaveLength(1);
  });
});

describe("the start-up work done", () => {
  // @spec DESK-SHELL-WIN-001
  it("replaces the start screen with the page", () => {
    const { w, shown } = open(STARTING);
    w.shellChanged({ quitting: false, serverDone: false, givenUp: null });
    expect(shown()).toEqual(["start"]);
    w.shellChanged(DONE);
    expect(w.view()).toBe("page");
    expect(shown()).toEqual(["start", "page"]);
  });

  // @spec DESK-SHELL-WIN-003
  it("replaces the failure screen with the page after Try again, keeping the failure screen while starting", () => {
    const reason = "The server did not start within 60 s";
    const { w, shown } = open(givenUp(reason));
    w.shellChanged(STARTING); // Try again: a new start
    expect(w.view()).toBe("failure");
    expect(shown()).toEqual(["failure"]);
    w.shellChanged(DONE);
    expect(w.view()).toBe("page");
    expect(shown()).toEqual(["failure", "page"]);
  });

  // @spec DESK-SHELL-WIN-001
  it("does not load a page already shown again", () => {
    const { w, loads } = onThePage();
    w.shellChanged(DONE);
    expect(loads).toEqual([PAGE]);
  });
});

describe("while the server restarts", () => {
  // @spec DESK-SHELL-WIN-004
  it("leaves the page in place, and in place again once done", async () => {
    const { w, loads, clock } = onThePage();
    w.shellChanged(STARTING); // restarting
    expect(w.view()).toBe("page");
    await clock.advance(5_000);
    w.shellChanged(STARTING); // a new process starting
    w.shellChanged(DONE);
    expect(w.view()).toBe("page");
    expect(loads).toEqual([PAGE]);
  });
});

describe("giving up", () => {
  // @spec DESK-SHELL-WIN-002
  it("shows the failure screen in place of the start screen or the page", () => {
    const fromStart = open(STARTING);
    fromStart.w.shellChanged(givenUp("Port 3280 is in use by another program"));
    expect(fromStart.w.view()).toBe("failure");
    expect(fromStart.loads.at(-1)).toBe(screenUrl({ kind: "failure", reason: "Port 3280 is in use by another program" }));

    const fromPage = onThePage();
    fromPage.w.shellChanged(givenUp("The server stopped responding"));
    expect(fromPage.w.view()).toBe("failure");
    expect(fromPage.loads).toEqual([PAGE, screenUrl({ kind: "failure", reason: "The server stopped responding" })]);
  });

  // @spec DESK-SHELL-WIN-002
  it("loads the failure screen once for one reason, and again for another", () => {
    const { w, loads } = open(givenUp("first reason"));
    w.shellChanged(givenUp("first reason"));
    expect(loads).toEqual([screenUrl({ kind: "failure", reason: "first reason" })]);
    w.shellChanged(givenUp("second reason"));
    expect(w.view()).toBe("failure");
    expect(loads).toEqual([screenUrl({ kind: "failure", reason: "first reason" }), screenUrl({ kind: "failure", reason: "second reason" })]);
  });
});

describe("quitting", () => {
  // @spec DESK-SHELL-WIN-032
  it("turns the start screen into the quitting screen", () => {
    const { w, loads, shown } = open(STARTING);
    w.shellChanged(QUITTING);
    expect(w.view()).toBe("quitting");
    expect(loads.at(-1)).toBe(screenUrl({ kind: "quitting" }));
    expect(shown()).toEqual(["start", "quitting"]);
  });

  // @spec DESK-SHELL-WIN-032
  it("leaves a window showing the page as it is", () => {
    const { w, loads } = onThePage();
    w.shellChanged(QUITTING_DONE);
    w.shellChanged(QUITTING);
    expect(w.view()).toBe("page");
    expect(loads).toEqual([PAGE]);
  });

  // @spec DESK-SHELL-WIN-032
  it("leaves the failure screen as it is", () => {
    const { w, loads } = open(givenUp("Port 3280 is in use by another program"));
    w.shellChanged({ quitting: true, serverDone: false, givenUp: "Port 3280 is in use by another program" });
    expect(w.view()).toBe("failure");
    expect(loads).toHaveLength(1);
  });

  // @spec DESK-SHELL-WIN-032
  it("shows the quitting screen, not the failure screen, for a start screen while quitting given up", () => {
    const { w, shown } = open(STARTING);
    w.shellChanged({ quitting: true, serverDone: false, givenUp: "Port 3280 is in use by another program" });
    expect(w.view()).toBe("quitting");
    expect(shown()).toEqual(["start", "quitting"]);
  });

  // @spec DESK-SHELL-WIN-032
  it("loads no page once quitting, though the server is done", () => {
    const { w, shown } = open(STARTING);
    w.shellChanged(QUITTING);
    w.shellChanged(QUITTING_DONE);
    expect(w.view()).toBe("quitting");
    expect(shown()).toEqual(["start", "quitting"]);
  });
});

describe("loading the page again after a requested restart", () => {
  // @spec DESK-SHELL-SRV-043
  it("loads the page again in a window showing it", () => {
    const { w, loads } = onThePage();
    w.shellChanged(STARTING); // the exit 12 and the new start: the page stays meanwhile
    w.shellChanged(DONE);
    expect(loads).toEqual([PAGE]);
    w.reload();
    expect(w.view()).toBe("page");
    expect(loads).toEqual([PAGE, PAGE]);
  });

  // @spec DESK-SHELL-SRV-043
  it("loads the page at once in a window on the start screen with the server done", async () => {
    const { w, loads, clock, shown } = onThePage();
    w.pageFailed(); // start screen; the page due 1 s later
    expect(w.view()).toBe("start");
    w.reload();
    expect(w.view()).toBe("page");
    expect(shown()).toEqual(["page", "start", "page"]);
    await clock.advance(1_000); // the retry finds the page shown: nothing more
    expect(loads).toHaveLength(3);
  });

  // @spec DESK-SHELL-SRV-043
  it("does nothing while not done, while quitting, or on the failure screen", () => {
    const starting = open(STARTING);
    starting.w.reload();
    expect(starting.loads).toHaveLength(1);
    expect(starting.w.view()).toBe("start");

    const restarting = onThePage();
    restarting.w.shellChanged(STARTING);
    restarting.w.reload();
    expect(restarting.loads).toEqual([PAGE]);
    expect(restarting.w.view()).toBe("page");

    const quitting = onThePage();
    quitting.w.shellChanged(QUITTING_DONE);
    quitting.w.reload();
    expect(quitting.loads).toEqual([PAGE]);

    const failed = open(givenUp("Port 3280 is in use by another program"));
    failed.w.reload();
    expect(failed.loads).toHaveLength(1);
    expect(failed.w.view()).toBe("failure");
  });
});

describe("a failed main-frame load", () => {
  // @spec DESK-SHELL-WIN-020
  it("with the server done, shows the start screen and loads the page again 1 s later", async () => {
    const { w, clock, shown } = onThePage();
    w.pageFailed();
    expect(w.view()).toBe("start");
    expect(shown()).toEqual(["page", "start"]);
    await clock.advance(999);
    expect(shown()).toEqual(["page", "start"]);
    await clock.advance(1);
    expect(w.view()).toBe("page");
    expect(shown()).toEqual(["page", "start", "page"]);
    await clock.advance(10_000);
    expect(shown()).toEqual(["page", "start", "page"]);
    expect(clock.pending()).toBe(0);
  });

  // @spec DESK-SHELL-WIN-020
  it("with the server not done, shows the start screen and loads the page once done", async () => {
    const { w, clock, shown } = onThePage();
    w.shellChanged(STARTING); // F5 while the server restarts
    w.pageFailed();
    expect(w.view()).toBe("start");
    await clock.advance(5_000);
    expect(shown()).toEqual(["page", "start"]);
    w.shellChanged(DONE);
    expect(w.view()).toBe("page");
    expect(shown()).toEqual(["page", "start", "page"]);
  });

  // @spec DESK-SHELL-WIN-020
  it("loads no page at 1 s when the server stopped being done meanwhile", async () => {
    const { w, clock, shown } = onThePage();
    w.pageFailed();
    await clock.advance(500);
    w.shellChanged(STARTING);
    await clock.advance(500);
    expect(w.view()).toBe("start");
    expect(shown()).toEqual(["page", "start"]);
    w.shellChanged(DONE);
    expect(shown()).toEqual(["page", "start", "page"]);
  });

  // @spec DESK-SHELL-WIN-020
  it("loads no page at 1 s when the shell gave up meanwhile", async () => {
    const { w, clock, shown } = onThePage();
    w.pageFailed();
    await clock.advance(500);
    w.shellChanged(givenUp("The server stopped responding"));
    await clock.advance(500);
    expect(w.view()).toBe("failure");
    expect(shown()).toEqual(["page", "start", "failure"]);
  });

  // @spec DESK-SHELL-WIN-020, DESK-SHELL-WIN-032
  it("loads no page at 1 s when quitting began meanwhile", async () => {
    const { w, clock, shown } = onThePage();
    w.pageFailed();
    await clock.advance(500);
    w.shellChanged(QUITTING_DONE);
    expect(w.view()).toBe("quitting");
    await clock.advance(500);
    expect(w.view()).toBe("quitting");
    expect(shown()).toEqual(["page", "start", "quitting"]);
  });

  // @spec DESK-SHELL-WIN-020
  it("while quitting, shows the quitting screen and loads no page", async () => {
    const { w, clock, shown } = onThePage();
    w.shellChanged(QUITTING_DONE);
    w.pageFailed();
    expect(w.view()).toBe("quitting");
    await clock.advance(5_000);
    expect(shown()).toEqual(["page", "quitting"]);
  });

  // @spec DESK-SHELL-WIN-020
  it("while given up, shows the failure screen and loads no page", async () => {
    const failure = screenUrl({ kind: "failure", reason: "The server stopped responding" });
    const { w, clock, loads } = open(givenUp("The server stopped responding"));
    w.pageFailed();
    expect(w.view()).toBe("failure");
    await clock.advance(5_000);
    // Whether the failure screen is loaded again over itself is left open; nothing else is loaded.
    expect(loads[0]).toBe(failure);
    for (const url of loads) expect(url).toBe(failure);
  });

  // @spec DESK-SHELL-WIN-020
  it("with the server done, loads the page at once when the shell says done again during the 1 s, and not again at 1 s", async () => {
    const { w, clock, shown } = onThePage();
    w.pageFailed();
    await clock.advance(400);
    w.shellChanged(DONE);
    expect(w.view()).toBe("page");
    expect(shown()).toEqual(["page", "start", "page"]);
    await clock.advance(5_000);
    expect(shown()).toEqual(["page", "start", "page"]);
  });

  // @spec DESK-SHELL-WIN-020, DESK-SHELL-WIN-021
  it("is no renderer loss: a lost renderer after it is the first", async () => {
    const { w, clock, shown, logs } = onThePage();
    w.pageFailed();
    await clock.advance(1_000);
    w.rendererGone();
    expect(w.view()).toBe("start");
    await clock.advance(1_000);
    expect(w.view()).toBe("page");
    expect(shown()).toEqual(["page", "start", "page", "start", "page"]);
    expect(logs).not.toContain(STOPPED_LINE);
  });
});

describe("a lost renderer", () => {
  // @spec DESK-SHELL-WIN-020
  it("the first time, does as a failed load", async () => {
    const { w, clock, shown, logs } = onThePage();
    w.rendererGone();
    expect(w.view()).toBe("start");
    await clock.advance(1_000);
    expect(w.view()).toBe("page");
    expect(shown()).toEqual(["page", "start", "page"]);
    expect(logs).not.toContain(STOPPED_LINE);
  });

  // @spec DESK-SHELL-WIN-021
  it("a second time within 5 minutes, shows the stopped screen and logs it", async () => {
    const { w, clock, shown, logs } = onThePage();
    w.rendererGone();
    await clock.advance(1_000);
    await clock.advance(299_000); // exactly 300 000 ms after the first loss
    w.rendererGone();
    expect(w.view()).toBe("stopped");
    expect(shown()).toEqual(["page", "start", "page", "stopped"]);
    expect(logs.filter((line) => line === STOPPED_LINE)).toHaveLength(1);
  });

  // @spec DESK-SHELL-WIN-021
  it("a second time more than 5 minutes after, does as a failed load", async () => {
    const { w, clock, shown, logs } = onThePage();
    w.rendererGone();
    await clock.advance(300_001);
    w.rendererGone();
    expect(w.view()).toBe("start");
    await clock.advance(1_000);
    expect(w.view()).toBe("page");
    expect(shown()).toEqual(["page", "start", "page", "start", "page"]);
    expect(logs).not.toContain(STOPPED_LINE);
  });

  // @spec DESK-SHELL-WIN-021
  it("counts the 5 minutes from the previous loss", async () => {
    const { w, clock } = onThePage();
    w.rendererGone();
    await clock.advance(300_001);
    w.rendererGone(); // not within 5 min of the first
    expect(w.view()).toBe("start");
    await clock.advance(200_000);
    w.rendererGone(); // within 5 min of the second
    expect(w.view()).toBe("stopped");
  });

  // @spec DESK-SHELL-WIN-021
  it("a second time before the page came back, stops the retry", async () => {
    const { w, clock, shown } = onThePage();
    w.rendererGone();
    await clock.advance(500);
    w.rendererGone();
    expect(w.view()).toBe("stopped");
    await clock.advance(5_000);
    expect(shown()).toEqual(["page", "start", "stopped"]);
  });

  // @spec DESK-SHELL-WIN-021
  it("stopped, the window changes for nothing ever again", async () => {
    const { w, clock, loads, logs } = onThePage();
    w.rendererGone();
    await clock.advance(1_000);
    w.rendererGone();
    expect(w.view()).toBe("stopped");
    const before = loads.length;
    w.shellChanged(STARTING);
    w.shellChanged(DONE);
    w.shellChanged(givenUp("The server stopped responding"));
    w.shellChanged(QUITTING);
    w.reload();
    w.pageFailed();
    w.rendererGone();
    await clock.advance(600_000);
    w.rendererGone();
    w.shellChanged(DONE);
    w.reload();
    await clock.advance(1_000);
    expect(w.view()).toBe("stopped");
    expect(loads).toHaveLength(before);
    expect(logs.filter((line) => line === STOPPED_LINE)).toHaveLength(1);
  });

  // @spec DESK-SHELL-WIN-020
  it("while quitting, shows the quitting screen", () => {
    const { w, shown } = onThePage();
    w.shellChanged(QUITTING_DONE);
    w.rendererGone();
    expect(w.view()).toBe("quitting");
    expect(shown()).toEqual(["page", "quitting"]);
  });

  // @spec DESK-SHELL-WIN-020
  it("while given up, keeps the failure screen and loads no page", async () => {
    const reason = "Port 3280 is in use by another program";
    const failure = screenUrl({ kind: "failure", reason });
    const { w, clock, loads } = open(givenUp(reason));
    w.rendererGone();
    expect(w.view()).toBe("failure");
    await clock.advance(5_000);
    // Whether the failure screen is loaded again into the new renderer is left open; nothing else is loaded.
    expect(loads[0]).toBe(failure);
    for (const url of loads) expect(url).toBe(failure);
  });
});
