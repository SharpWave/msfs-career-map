/**
 * The desktop tests' guard and clock (DESK-SHELL-TEST-001; m2 contract §18): the shell's unit tests
 * run in Node without Electron and reach no process, port, Electron, network or account folder
 * except through the stand-ins they inject; a test that reaches a real one fails. Time moves only
 * by `await clock.advance(ms)`.
 */
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import util from "node:util";
import { describe, expect, inject, it } from "vitest";

import { execFile, spawn } from "node:child_process";
import childProcess from "child_process";
import * as nodeNet from "node:net";
import net from "net";
import { get as httpGet } from "node:http";
import http from "http";
import { request as httpsRequest } from "node:https";
import https from "https";
import { createSocket } from "node:dgram";
import dgram from "dgram";
import { app, BrowserWindow } from "electron";
import electron from "electron";

import { takeRefused } from "../../support/fetch-guard.ts";
import { decoyFolder, takeGuardHits } from "../support/guard.ts";
import { FakeClock, flush } from "../support/clock.ts";
import { FakeBoxes, FakeChild, FakeHttp, FakeLauncher, FakeWindow, screenOf, statusAnswer } from "../support/fakes.ts";

type AnyFn = (...args: unknown[]) => unknown;
type AnyCtor = new (...args: unknown[]) => unknown;
const call = (f: unknown, ...args: unknown[]) => (f as AnyFn)(...args);
const construct = (f: unknown) => new (f as AnyCtor)();
const read = (o: unknown, key: PropertyKey) => (o as Record<PropertyKey, unknown>)[key];

describe("the guard on the shell's ways out", () => {
  // @spec DESK-SHELL-TEST-001
  it("refuses a call of each guarded module's named export, recorded under the bare module name", () => {
    const cases: [unknown, string][] = [
      [execFile, "child_process.execFile"],
      [spawn, "child_process.spawn"],
      [nodeNet.connect, "net.connect"],
      [httpGet, "http.get"],
      [httpsRequest, "https.request"],
      [createSocket, "dgram.createSocket"],
    ];
    for (const [fn, name] of cases) {
      expect(() => call(fn, "x")).toThrow(`desktop tests may not reach ${name}`);
    }
    expect(takeGuardHits()).toEqual(cases.map(([, name]) => name));
  });

  // @spec DESK-SHELL-TEST-001
  it("refuses the default import's functions the same way, whichever spelling was imported", () => {
    expect(() => call(childProcess.execFile, "x")).toThrow("desktop tests may not reach child_process.execFile");
    expect(() => call(net.createServer)).toThrow("desktop tests may not reach net.createServer");
    expect(() => call(http.request, "http://127.0.0.1:3280/")).toThrow("desktop tests may not reach http.request");
    expect(() => call(https.get, "https://example.com/")).toThrow("desktop tests may not reach https.get");
    expect(() => call(dgram.createSocket, "udp4")).toThrow("desktop tests may not reach dgram.createSocket");
    expect(takeGuardHits()).toEqual([
      "child_process.execFile",
      "net.createServer",
      "http.request",
      "https.get",
      "dgram.createSocket",
    ]);
  });

  // @spec DESK-SHELL-TEST-001
  it("refuses electron's app, named or default, and a property read of it adds its key", () => {
    expect(() => call(read(app, "getPath"), "userData")).toThrow("desktop tests may not reach electron.app.getPath");
    expect(() => read(electron.app, "isPackaged")).toThrow("desktop tests may not reach electron.app.isPackaged");
    expect(() => read(app, "requestSingleInstanceLock")).toThrow(
      "desktop tests may not reach electron.app.requestSingleInstanceLock",
    );
    expect(takeGuardHits()).toEqual([
      "electron.app.getPath",
      "electron.app.isPackaged",
      "electron.app.requestSingleInstanceLock",
    ]);
  });

  // @spec DESK-SHELL-TEST-001
  it("refuses an export constructed with new", () => {
    expect(() => construct(BrowserWindow)).toThrow("desktop tests may not reach electron.BrowserWindow");
    expect(() => construct(electron.Tray)).toThrow("desktop tests may not reach electron.Tray");
    expect(() => construct(net.Socket)).toThrow("desktop tests may not reach net.Socket");
    expect(takeGuardHits()).toEqual(["electron.BrowserWindow", "electron.Tray", "net.Socket"]);
  });

  // @spec DESK-SHELL-TEST-001
  it("refuses a string-keyed read of an export", () => {
    expect(() => read(execFile, "foo")).toThrow("desktop tests may not reach child_process.execFile.foo");
    expect(() => read(childProcess.spawn, "name")).toThrow("desktop tests may not reach child_process.spawn.name");
    expect(takeGuardHits()).toEqual(["child_process.execFile.foo", "child_process.spawn.name"]);
  });

  // @spec DESK-SHELL-TEST-001
  it("gives undefined, recording nothing, for symbol-keyed reads, then and __esModule", () => {
    for (const target of [execFile, app, childProcess, electron, http]) {
      expect(read(target, util.promisify.custom)).toBeUndefined();
      expect(read(target, Symbol.toPrimitive)).toBeUndefined();
      expect(read(target, Symbol.toStringTag)).toBeUndefined();
      expect(read(target, "then")).toBeUndefined();
      expect(read(target, "__esModule")).toBeUndefined();
    }
    expect(takeGuardHits()).toEqual([]);
  });

  // @spec DESK-SHELL-TEST-001
  it("lets promisify(execFile) be made, and refuses calling what it made", async () => {
    const run = promisify(execFile) as unknown as (file: string, args: string[]) => Promise<unknown>;
    expect(typeof run).toBe("function");
    expect(takeGuardHits()).toEqual([]);
    await expect(Promise.resolve().then(() => run("tasklist.exe", []))).rejects.toThrow(
      "desktop tests may not reach child_process.execFile",
    );
    expect(takeGuardHits()).toEqual(["child_process.execFile"]);
  });

  // @spec DESK-SHELL-TEST-001
  it("lets process.kill look with signal 0 and refuses ending a process", () => {
    expect(process.kill(process.pid, 0)).toBe(true);
    expect(takeGuardHits()).toEqual([]);
    // A pid no process can have, so even an unguarded kill could end nothing.
    expect(() => process.kill(999_999_996)).toThrow("desktop tests may not reach process.kill(999999996)");
    expect(takeGuardHits()).toEqual(["process.kill(999999996)"]);
  });

  // @spec DESK-SHELL-TEST-001
  it("refuses a fetch even of a loopback address", async () => {
    await expect(fetch("http://127.0.0.1:3280/")).rejects.toThrow(/refused/);
    expect(takeRefused()).toEqual(["http://127.0.0.1:3280/"]);
  });

  // @spec DESK-SHELL-TEST-001
  it("points LOCALAPPDATA, APPDATA and USERPROFILE into a decoy folder in the run's folder", () => {
    const decoy = decoyFolder();
    expect(path.relative(inject("runDir"), decoy)).not.toMatch(/^\.\.|^[A-Za-z]:/);
    expect(process.env.LOCALAPPDATA).toBe(path.join(decoy, "Local"));
    expect(process.env.APPDATA).toBe(path.join(decoy, "Roaming"));
    expect(process.env.USERPROFILE).toBe(path.join(decoy, "Profile"));
    for (const folder of ["Local", "Roaming", "Profile"]) {
      expect(fs.statSync(path.join(decoy, folder)).isDirectory()).toBe(true);
    }
  });
});

describe("FakeClock", () => {
  // @spec DESK-SHELL-TEST-001
  it("starts at its defaults or the times given", () => {
    const clock = new FakeClock();
    expect(clock.now()).toBe(1_000_000);
    expect(clock.wallNow().toISOString()).toBe("2026-10-25T12:00:00.000Z");
    const other = new FakeClock({ now: 5, wall: "2026-01-01T00:00:00.000Z" });
    expect(other.now()).toBe(5);
    expect(other.wallNow().toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  // @spec DESK-SHELL-TEST-001
  it("fires timers in time order, equal times in scheduling order, each at its own time", async () => {
    const clock = new FakeClock({ now: 0 });
    const fired: string[] = [];
    clock.after(300, () => fired.push(`a@${clock.now()}`));
    clock.after(100, () => fired.push(`b@${clock.now()}`));
    clock.after(100, () => fired.push(`c@${clock.now()}`));
    clock.after(301, () => fired.push(`d@${clock.now()}`));
    await clock.advance(300);
    expect(fired).toEqual(["b@100", "c@100", "a@300"]);
    expect(clock.now()).toBe(300);
    expect(clock.pending()).toBe(1);
    await clock.advance(1);
    expect(fired.at(-1)).toBe("d@301");
  });

  // @spec DESK-SHELL-TEST-001
  it("advance(0) fires what is due now", async () => {
    const clock = new FakeClock();
    let fired = 0;
    clock.after(0, () => fired++);
    expect(fired).toBe(0);
    await clock.advance(0);
    expect(fired).toBe(1);
  });

  // @spec DESK-SHELL-TEST-001
  it("settles a promise chain between timers, and fires timers it schedules when due", async () => {
    const clock = new FakeClock({ now: 0 });
    const log: string[] = [];
    clock.after(100, () => {
      log.push(`t@${clock.now()}`);
      void Promise.resolve()
        .then(() => Promise.resolve())
        .then(() => {
          log.push(`chain@${clock.now()}`);
          clock.after(50, () => log.push(`later@${clock.now()}`));
        });
    });
    clock.after(200, () => log.push(`u@${clock.now()}`));
    await clock.advance(1000);
    expect(log).toEqual(["t@100", "chain@100", "later@150", "u@200"]);
  });

  // @spec DESK-SHELL-TEST-001
  it("drives a loop that awaits a port between waits as the real clock would", async () => {
    const clock = new FakeClock({ now: 0 });
    const asks: number[] = [];
    let running = true;
    const port = () => Promise.resolve().then(() => null);
    void (async () => {
      while (running) {
        asks.push(clock.now());
        await port();
        await new Promise<void>((resolve) => clock.after(250, resolve));
      }
    })();
    await flush();
    await clock.advance(1000);
    running = false;
    expect(asks).toEqual([0, 250, 500, 750, 1000]);
  });

  // @spec DESK-SHELL-TEST-001
  it("moves the wall clock with time, and setWall moves the wall clock alone", async () => {
    const clock = new FakeClock();
    await clock.advance(1500);
    expect(clock.now()).toBe(1_001_500);
    expect(clock.wallNow().toISOString()).toBe("2026-10-25T12:00:01.500Z");

    let fired = false;
    clock.after(1000, () => (fired = true));
    clock.setWall("2026-10-27T00:00:00.000Z");
    expect(clock.now()).toBe(1_001_500);
    expect(clock.pending()).toBe(1);
    await clock.advance(999);
    expect(fired).toBe(false);
    clock.setWall(new Date("2026-10-20T00:00:00.000Z"));
    await clock.advance(1);
    expect(fired).toBe(true);
    expect(clock.wallNow().toISOString()).toBe("2026-10-20T00:00:00.001Z");
  });

  // @spec DESK-SHELL-TEST-001
  it("counts live timers: a cancel or a fire drops one, a cancel after the fire changes nothing", async () => {
    const clock = new FakeClock();
    const cancelA = clock.after(100, () => {});
    const cancelB = clock.after(200, () => {});
    expect(clock.pending()).toBe(2);
    cancelA();
    expect(clock.pending()).toBe(1);
    cancelA();
    expect(clock.pending()).toBe(1);
    await clock.advance(200);
    expect(clock.pending()).toBe(0);
    cancelB();
    expect(clock.pending()).toBe(0);
  });
});

describe("the stand-ins", () => {
  // @spec DESK-SHELL-TEST-001
  it("FakeChild: pids from 4000 by start, kill exits 0 on the next microtask, a kill before spawn exits at it", async () => {
    const launcher = new FakeLauncher();
    const o = { script: "s", args: [], env: {}, cwd: "c", serviceName: "n" };
    const a = launcher.start(o);
    const b = launcher.start(o);
    expect(launcher.last()).toBe(b);
    const exits: number[] = [];
    a.onExit((code) => exits.push(code));
    b.onExit((code) => exits.push(100 + code));

    a.spawn();
    expect(a.pid).toBe(4000);
    a.kill();
    expect(a.killed).toBe(true);
    expect(exits).toEqual([]);
    await Promise.resolve();
    expect(exits).toEqual([0]);

    b.kill();
    await flush();
    expect(exits).toEqual([0]);
    b.spawn();
    expect(b.pid).toBe(4001);
    await flush();
    expect(exits).toEqual([0, 100]);
    b.exit(3);
    expect(exits).toEqual([0, 100]);
  });

  // @spec DESK-SHELL-TEST-001
  it("FakeChild: ignoreKill records the kill without an exit; post needs a spawned process", async () => {
    const child = new FakeLauncher().start({ script: "s", args: [], env: {}, cwd: "c", serviceName: "n" });
    expect(() => child.post({ type: "x" })).toThrow();
    child.spawn(77);
    child.post({ type: "shutdown" });
    expect(child.posted).toEqual([{ type: "shutdown" }]);
    child.ignoreKill = true;
    child.kill();
    await flush();
    expect(child.killed).toBe(true);
    expect(child.exited).toBeNull();
  });

  // @spec DESK-SHELL-TEST-001
  it("FakeHttp: answers what the test set, null otherwise, and records every call", async () => {
    const http = new FakeHttp();
    http.on(3280, "/api/status", statusAnswer({ pid: 4000 }));
    http.on(3280, "/api/tracker", (c) => ({ status: 200, body: String(c.timeoutMs) }));
    expect(JSON.parse((await http.get(3280, "/api/status", 1000))!.body)).toMatchObject({ pid: 4000, startup: "done" });
    expect(await http.get(3280, "/api/tracker", 10_000)).toEqual({ status: 200, body: "10000" });
    expect(await http.get(3281, "/api/status", 1000)).toBeNull();
    expect(http.calls).toEqual([
      { port: 3280, path: "/api/status", timeoutMs: 1000 },
      { port: 3280, path: "/api/tracker", timeoutMs: 10_000 },
      { port: 3281, path: "/api/status", timeoutMs: 1000 },
    ]);
    const chunks: string[] = [];
    const s = http.stream(3280, "/api/tracker/events", { onChunk: (t) => chunks.push(t), onEnd: () => chunks.push("end") });
    s.chunk(": ping\n\n");
    expect(http.openStreams()).toEqual([s]);
    s.close();
    s.chunk("late");
    s.end();
    expect(chunks).toEqual([": ping\n\n"]);
    expect(http.openStreams()).toEqual([]);
  });

  // @spec DESK-SHELL-TEST-001
  it("FakeBoxes: an abort resolves cancelId, before or while shown", async () => {
    const boxes = new FakeBoxes();
    const options = { type: "warning" as const, title: "t", message: "m", buttons: ["Quit", "Cancel"], defaultId: 1, cancelId: 1 };
    const open = new AbortController();
    const answer = boxes.show({ ...options, signal: open.signal });
    open.abort();
    expect(await answer).toBe(1);
    expect(boxes.shown[0].aborted).toBe(true);
    const early = new AbortController();
    early.abort();
    expect(await boxes.show({ ...options, signal: early.signal })).toBe(1);
    const third = boxes.show({ ...options, signal: new AbortController().signal });
    boxes.shown[2].answer(0);
    expect(await third).toBe(0);
  });

  // @spec DESK-SHELL-TEST-001
  it("FakeWindow: created once, then shown; place only while open", () => {
    const window = new FakeWindow();
    expect(window.place()).toBeNull();
    expect(window.open()).toBe("created");
    expect(window.open()).toBe("shown");
    expect(window.createdCount).toBe(1);
    expect(window.openCalls).toBe(2);
    expect(window.place()).toEqual({ x: 100, y: 100, width: 1280, height: 800, maximized: false });
    window.close();
    expect(window.isOpen()).toBe(false);
    expect(window.open()).toBe("created");
  });

  // @spec DESK-SHELL-TEST-001
  it("screenOf knows the page and each screen screenUrl makes", async () => {
    expect(screenOf("http://127.0.0.1:3280/", 3280)).toBe("page");
    expect(screenOf("http://127.0.0.1:3281/", 3280)).toBe("other");
    // The one check here that needs the shell's own module.
    const { screenUrl } = await import("../../../src/desktop/screens.ts");
    expect(screenOf(screenUrl({ kind: "start" }), 3280)).toBe("start");
    expect(screenOf(screenUrl({ kind: "failure", reason: "Port 3280 is in use by another program" }), 3280)).toBe("failure");
    expect(screenOf(screenUrl({ kind: "quitting" }), 3280)).toBe("quitting");
    expect(screenOf(screenUrl({ kind: "stopped" }), 3280)).toBe("stopped");
  });
});
