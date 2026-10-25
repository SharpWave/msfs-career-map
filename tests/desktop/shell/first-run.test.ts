/**
 * The first run's look for a copy run from source (src/desktop/first-run.ts; m2 contract §12.2):
 * an installed copy asks `http://127.0.0.1:3080/api/status`, counting only an answer from this app
 * naming its data folder and a sim other than the fake feed (DESK-SHELL-FIRST-001); a folder is
 * accepted only as an absolute path on a fixed drive that exists and holds `career.db`
 * (DESK-SHELL-FIRST-002); the folder accepted is remembered (DESK-SHELL-FIRST-003) and offered, else
 * the remembered one unless its check fails (DESK-SHELL-FIRST-004). One 500 ms bound on the clock
 * covers the ask and every check, so the server's start never waits longer (DESK-SHELL-SRV-004).
 * Folder checks run on temp folders; a path that would reach the network is only ever given to
 * stand-in checks.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SOURCE_PORT, acceptSourceFolder, lookForSourceCopy, type FirstRunLook } from "../../../src/desktop/first-run.ts";
import { FakeClock, flush } from "../support/clock.ts";
import { FakeFacts, FakeHttp, never, statusAnswer, tempFolder, type HttpReply } from "../support/fakes.ts";

/** A data folder of a copy run from source: a temp folder holding career.db. */
function sourceFolder(): string {
  const folder = tempFolder("source-");
  fs.writeFileSync(path.join(folder, "career.db"), "");
  return folder;
}

/** The upper-case drive letter of a temp folder. */
function letterOf(p: string): string {
  return path.win32.parse(path.win32.resolve(p)).root[0].toUpperCase();
}

/** Facts reporting the temp folders' drive as fixed. */
function facts(): FakeFacts {
  const f = new FakeFacts();
  f.fixed = new Set([letterOf(tempFolder("drive-"))]);
  return f;
}

/** An answer from a copy run from source on `dataFolder` with `sim`. */
function sourceAnswer(dataFolder: string, sim: unknown = "off", more: Record<string, unknown> = {}) {
  return statusAnswer({ pid: 9100, dataFolder, sim, ...more });
}

interface Look {
  clock: FakeClock;
  http: FakeHttp;
  facts: FakeFacts;
  result: { done: boolean; value: FirstRunLook | null; error: unknown };
}

/** Starts a look with `reply` on 3080 and `remembered`; returns its parts and a record of its outcome. */
function look(reply: HttpReply | undefined, remembered: string | null, f: FakeFacts = facts()): Look {
  const clock = new FakeClock();
  const http = new FakeHttp();
  if (reply !== undefined) http.on(3080, "/api/status", reply);
  const result: Look["result"] = { done: false, value: null, error: undefined };
  lookForSourceCopy({ http, clock, remembered, isFixedDrive: (l: string) => f.isFixedDrive(l) }).then(
    (v: FirstRunLook) => {
      result.done = true;
      result.value = v;
    },
    (e: unknown) => {
      result.done = true;
      result.error = e;
    },
  );
  return { clock, http, facts: f, result };
}

/** Lets a look that needs no time settle, and checks it did so without the clock. */
async function settledEarly(l: Look): Promise<FirstRunLook | null> {
  await flush();
  expect(l.result.done).toBe(true);
  expect(l.result.error).toBeUndefined();
  expect(l.clock.pending()).toBe(0);
  return l.result.value;
}

describe("the ask", () => {
  // @spec DESK-SHELL-FIRST-001
  it("asks /api/status on port 3080 once, bounded by 500 ms", async () => {
    expect(SOURCE_PORT).toBe(3080);
    const l = look(null, null);
    await settledEarly(l);
    expect(l.http.calls).toEqual([{ port: 3080, path: "/api/status", timeoutMs: 500 }]);
  });
});

describe("a detection", () => {
  // @spec DESK-SHELL-FIRST-001, DESK-SHELL-FIRST-003, DESK-SHELL-FIRST-004
  it("counts a copy run from source with its sim off", async () => {
    const f = sourceFolder();
    expect(await settledEarly(look(sourceAnswer(f, "off"), null))).toEqual({ offer: f, sourceFolder: f });
  });

  // @spec DESK-SHELL-FIRST-001, DESK-SHELL-FIRST-003, DESK-SHELL-FIRST-004
  it("counts a copy run from source on the sim link", async () => {
    const f = sourceFolder();
    expect(await settledEarly(look(sourceAnswer(f, "link"), null))).toEqual({ offer: f, sourceFolder: f });
  });

  // @spec DESK-SHELL-FIRST-001
  it("never counts a copy on the fake feed, nor an answer without a sim", async () => {
    const f = sourceFolder();
    const none = { offer: null, sourceFolder: null };
    expect(await settledEarly(look(sourceAnswer(f, "fake"), null))).toEqual(none);
    const noSim = sourceAnswer(f);
    const { sim: _sim, ...withoutSim } = JSON.parse(noSim.body);
    expect(await settledEarly(look({ ...noSim, body: JSON.stringify(withoutSim) }, null))).toEqual(none);
    expect(await settledEarly(look(sourceAnswer(f, null), null))).toEqual(none);
    expect(await settledEarly(look(sourceAnswer(f, "on"), null))).toEqual(none);
  });

  // @spec DESK-SHELL-FIRST-001
  it("never counts an answer without a data folder, or with one that is not a string", async () => {
    const none = { offer: null, sourceFolder: null };
    expect(await settledEarly(look(statusAnswer({ pid: 9100, sim: "off", dataFolder: undefined }), null))).toEqual(none);
    expect(await settledEarly(look(statusAnswer({ pid: 9100, sim: "off", dataFolder: 42 }), null))).toEqual(none);
    expect(await settledEarly(look(statusAnswer({ pid: 9100, sim: "off", dataFolder: null }), null))).toEqual(none);
  });

  // @spec DESK-SHELL-FIRST-001
  it("never counts another app, a status other than 200, or a body that is not JSON", async () => {
    const f = sourceFolder();
    const none = { offer: null, sourceFolder: null };
    expect(await settledEarly(look(sourceAnswer(f, "off", { app: "another-app" }), null))).toEqual(none);
    expect(await settledEarly(look(sourceAnswer(f, "off", { app: undefined }), null))).toEqual(none);
    expect(await settledEarly(look({ status: 503, body: sourceAnswer(f, "off").body }, null))).toEqual(none);
    expect(await settledEarly(look({ status: 404, body: sourceAnswer(f, "off").body }, null))).toEqual(none);
    expect(await settledEarly(look({ status: 200, body: "<html>not json</html>" }, null))).toEqual(none);
    expect(await settledEarly(look({ status: 200, body: "[]" }, null))).toEqual(none);
  });

  // @spec DESK-SHELL-FIRST-001, DESK-SHELL-SRV-004
  it("never counts an answer that comes after 500 ms", async () => {
    const f = sourceFolder();
    const clock = new FakeClock();
    const http = new FakeHttp();
    http.on(3080, "/api/status", () => new Promise((resolve) => clock.after(600, () => resolve(sourceAnswer(f, "off")))));
    const fx = facts();
    let value: FirstRunLook | null = null;
    let done = false;
    void lookForSourceCopy({ http, clock, remembered: null, isFixedDrive: (l: string) => fx.isFixedDrive(l) }).then((v: FirstRunLook) => {
      value = v;
      done = true;
    });
    await clock.advance(499);
    expect(done).toBe(false);
    await clock.advance(1);
    expect(done).toBe(true);
    expect(value).toEqual({ offer: null, sourceFolder: null });
    await clock.advance(200);
    expect(value).toEqual({ offer: null, sourceFolder: null });
  });

  // @spec DESK-SHELL-FIRST-001, DESK-SHELL-SRV-004
  it("ends at 500 ms when the ask never answers", async () => {
    const l = look(() => never(), null);
    await l.clock.advance(499);
    expect(l.result.done).toBe(false);
    await l.clock.advance(1);
    expect(l.result.done).toBe(true);
    expect(l.result.value).toEqual({ offer: null, sourceFolder: null });
    expect(l.clock.pending()).toBe(0);
  });
});

describe("acceptSourceFolder", () => {
  // @spec DESK-SHELL-FIRST-002
  it("accepts an existing folder holding career.db on a fixed drive, asking about its upper-case letter", async () => {
    const f = sourceFolder();
    const fx = facts();
    expect(await acceptSourceFolder(f, { isFixedDrive: (l: string) => fx.isFixedDrive(l) })).toBe(true);
    const lower = f[0].toLowerCase() + f.slice(1);
    expect(await acceptSourceFolder(lower, { isFixedDrive: (l: string) => fx.isFixedDrive(l) })).toBe(true);
    const drives = fx.calls.filter((c) => c.startsWith("isFixedDrive"));
    expect(drives.length).toBeGreaterThan(0);
    expect(new Set(drives)).toEqual(new Set([`isFixedDrive ${letterOf(f)}`]));
  });

  // @spec DESK-SHELL-FIRST-002
  it("refuses a folder without career.db, or whose career.db is a folder", async () => {
    const fx = facts();
    const empty = tempFolder("source-");
    expect(await acceptSourceFolder(empty, { isFixedDrive: (l: string) => fx.isFixedDrive(l) })).toBe(false);
    const dirDb = tempFolder("source-");
    fs.mkdirSync(path.join(dirDb, "career.db"));
    expect(await acceptSourceFolder(dirDb, { isFixedDrive: (l: string) => fx.isFixedDrive(l) })).toBe(false);
  });

  // @spec DESK-SHELL-FIRST-002
  it("refuses a file in place of the folder, and a folder that does not exist", async () => {
    const fx = facts();
    const parent = tempFolder("source-");
    const file = path.join(parent, "career.db");
    fs.writeFileSync(file, "");
    expect(await acceptSourceFolder(file, { isFixedDrive: (l: string) => fx.isFixedDrive(l) })).toBe(false);
    expect(await acceptSourceFolder(path.join(parent, "missing"), { isFixedDrive: (l: string) => fx.isFixedDrive(l) })).toBe(false);
  });

  // @spec DESK-SHELL-FIRST-002
  it("refuses a folder on a drive Windows does not report as fixed", async () => {
    const f = sourceFolder();
    const fx = new FakeFacts();
    fx.fixed = new Set();
    expect(await acceptSourceFolder(f, { isFixedDrive: (l: string) => fx.isFixedDrive(l) })).toBe(false);
  });

  // @spec DESK-SHELL-FIRST-002
  it("refuses network, device, relative and drive-relative paths by their form alone", async () => {
    const isFile: string[] = [];
    const checks = {
      isFixedDrive: () => Promise.resolve(true),
      isDirectory: () => true,
      isFile: (p: string) => {
        isFile.push(p);
        return true;
      },
    };
    for (const p of [
      "\\\\server\\share\\data",
      "//server/share/data",
      "\\\\?\\C:\\career\\data",
      "\\\\.\\C:\\career\\data",
      "data",
      "..\\data",
      "C:data",
      "\\career\\data",
      "",
    ]) {
      expect(await acceptSourceFolder(p, checks), p).toBe(false);
    }
    // The same checks accept an absolute path on a drive letter, looking for <folder>\career.db.
    expect(await acceptSourceFolder("C:\\career\\data", checks)).toBe(true);
    expect(isFile).toContain("C:\\career\\data\\career.db");
    expect(await acceptSourceFolder("D:/career/data", checks)).toBe(true);
  });

  // @spec DESK-SHELL-FIRST-002
  it("refuses anything that is not a string", async () => {
    const checks = { isFixedDrive: () => Promise.resolve(true), isDirectory: () => true, isFile: () => true };
    for (const v of [null, undefined, 42, {}, ["C:\\x"], true]) {
      expect(await acceptSourceFolder(v, checks)).toBe(false);
    }
  });
});

describe("the look's outcome", () => {
  // @spec DESK-SHELL-FIRST-003, DESK-SHELL-FIRST-004
  it("offers and remembers the folder found and accepted, over a remembered one", async () => {
    const found = sourceFolder();
    const remembered = sourceFolder();
    expect(await settledEarly(look(sourceAnswer(found, "link"), remembered))).toEqual({ offer: found, sourceFolder: found });
  });

  // @spec DESK-SHELL-FIRST-004
  it("keeps and offers a remembered folder that passes when none is found, whether or not a copy runs", async () => {
    const remembered = sourceFolder();
    expect(await settledEarly(look(null, remembered))).toEqual({ offer: remembered, sourceFolder: remembered });
    expect(await settledEarly(look(undefined, remembered))).toEqual({ offer: remembered, sourceFolder: remembered });
  });

  // @spec DESK-SHELL-FIRST-004
  it("keeps the remembered folder when the one found is not accepted or not counted", async () => {
    const remembered = sourceFolder();
    const notAccepted = tempFolder("source-"); // no career.db
    expect(await settledEarly(look(sourceAnswer(notAccepted, "off"), remembered))).toEqual({
      offer: remembered,
      sourceFolder: remembered,
    });
    const onFake = sourceFolder();
    expect(await settledEarly(look(sourceAnswer(onFake, "fake"), remembered))).toEqual({
      offer: remembered,
      sourceFolder: remembered,
    });
  });

  // @spec DESK-SHELL-FIRST-002, DESK-SHELL-FIRST-004
  it("drops a remembered folder that fails the rules", async () => {
    const gone = tempFolder("source-"); // career.db removed since
    expect(await settledEarly(look(null, gone))).toEqual({ offer: null, sourceFolder: null });
    expect(await settledEarly(look(null, path.join(gone, "missing")))).toEqual({ offer: null, sourceFolder: null });
    const notFixed = new FakeFacts();
    notFixed.fixed = new Set();
    expect(await settledEarly(look(null, sourceFolder(), notFixed))).toEqual({ offer: null, sourceFolder: null });
  });

  // @spec DESK-SHELL-FIRST-004
  it("drops a remembered folder that fails even when the one found is not accepted either", async () => {
    const gone = tempFolder("source-");
    const notAccepted = tempFolder("source-");
    expect(await settledEarly(look(sourceAnswer(notAccepted, "off"), gone))).toEqual({ offer: null, sourceFolder: null });
  });

  // @spec DESK-SHELL-FIRST-003, DESK-SHELL-FIRST-004
  it("takes a found folder equal to the remembered one, in another case, as one folder", async () => {
    const remembered = sourceFolder();
    const found = remembered.toUpperCase();
    const out = await settledEarly(look(sourceAnswer(found, "off"), remembered));
    expect(out?.offer?.toLowerCase()).toBe(remembered.toLowerCase());
    expect(out?.sourceFolder?.toLowerCase()).toBe(remembered.toLowerCase());
  });

  // @spec DESK-SHELL-FIRST-004
  it("drops a remembered folder found again when it fails the rules", async () => {
    const gone = tempFolder("source-");
    expect(await settledEarly(look(sourceAnswer(gone, "off"), gone))).toEqual({ offer: null, sourceFolder: null });
  });

  // @spec DESK-SHELL-FIRST-001
  it("with nothing found and nothing remembered, gives none", async () => {
    expect(await settledEarly(look(null, null))).toEqual({ offer: null, sourceFolder: null });
  });
});

describe("the one 500 ms bound", () => {
  // @spec DESK-SHELL-SRV-004, DESK-SHELL-FIRST-001, DESK-SHELL-FIRST-004
  it("ends at exactly 500 ms when no drive look ever answers: the found folder neither offered nor remembered, the remembered one kept and offered", async () => {
    const found = sourceFolder();
    const remembered = sourceFolder();
    const fx = new FakeFacts();
    fx.isFixedDriveReply = () => never();
    const l = look(sourceAnswer(found, "off"), remembered, fx);
    await flush();
    expect(l.result.done).toBe(false);
    await l.clock.advance(499);
    expect(l.result.done).toBe(false);
    await l.clock.advance(1);
    expect(l.result.done).toBe(true);
    expect(l.result.error).toBeUndefined();
    expect(l.result.value).toEqual({ offer: remembered, sourceFolder: remembered });
    expect(l.clock.pending()).toBe(0);
  });

  // @spec DESK-SHELL-SRV-004, DESK-SHELL-FIRST-001
  it("ends at 500 ms with none when only a found folder's drive look hangs", async () => {
    const found = sourceFolder();
    const fx = new FakeFacts();
    fx.isFixedDriveReply = () => never();
    const l = look(sourceAnswer(found, "link"), null, fx);
    await l.clock.advance(499);
    expect(l.result.done).toBe(false);
    await l.clock.advance(1);
    expect(l.result.value).toEqual({ offer: null, sourceFolder: null });
  });

  // @spec DESK-SHELL-SRV-004, DESK-SHELL-FIRST-004
  it("keeps and offers a remembered folder whose drive look is still pending at 500 ms", async () => {
    const remembered = sourceFolder();
    const fx = new FakeFacts();
    fx.isFixedDriveReply = () => never();
    const l = look(null, remembered, fx);
    await l.clock.advance(499);
    expect(l.result.done).toBe(false);
    await l.clock.advance(1);
    expect(l.result.value).toEqual({ offer: remembered, sourceFolder: remembered });
  });

  // @spec DESK-SHELL-SRV-004, DESK-SHELL-FIRST-001, DESK-SHELL-FIRST-003
  it("waits for an answer and a drive look that settle within 500 ms, and ends as soon as they have", async () => {
    const found = sourceFolder();
    const clock = new FakeClock();
    const http = new FakeHttp();
    http.on(3080, "/api/status", () => new Promise((resolve) => clock.after(100, () => resolve(sourceAnswer(found, "off")))));
    const fx = facts();
    fx.isFixedDriveReply = (l: string) => new Promise<boolean>((resolve) => clock.after(200, () => resolve(fx.fixed.has(l))));
    let value: FirstRunLook | null = null;
    let done = false;
    void lookForSourceCopy({ http, clock, remembered: null, isFixedDrive: (l: string) => fx.isFixedDrive(l) }).then((v: FirstRunLook) => {
      value = v;
      done = true;
    });
    // The answer at 100 ms, the found folder's drive look 200 ms after it.
    await clock.advance(299);
    expect(done).toBe(false);
    await clock.advance(1);
    expect(done).toBe(true);
    expect(value).toEqual({ offer: found, sourceFolder: found });
    expect(clock.pending()).toBe(0);
  });

  // @spec DESK-SHELL-SRV-004, DESK-SHELL-FIRST-004
  it("checks the remembered folder beside the ask, not after it: one that fails within 500 ms is dropped though the ask never answers", async () => {
    const remembered = sourceFolder();
    const clock = new FakeClock();
    const http = new FakeHttp();
    http.on(3080, "/api/status", () => never());
    const fx = facts();
    fx.isFixedDriveReply = () => new Promise<boolean>((resolve) => clock.after(300, () => resolve(false)));
    let value: FirstRunLook | null = null;
    let done = false;
    void lookForSourceCopy({ http, clock, remembered, isFixedDrive: (l: string) => fx.isFixedDrive(l) }).then((v: FirstRunLook) => {
      value = v;
      done = true;
    });
    await clock.advance(499);
    expect(done).toBe(false);
    await clock.advance(1);
    expect(done).toBe(true);
    expect(value).toEqual({ offer: null, sourceFolder: null });
    expect(clock.pending()).toBe(0);
  });

  // @spec DESK-SHELL-SRV-004
  it("resolves before 500 ms and leaves no timer when everything settles first", async () => {
    const found = sourceFolder();
    const remembered = sourceFolder();
    const l = look(sourceAnswer(found, "off"), remembered);
    const before = l.clock.now();
    expect(await settledEarly(l)).toEqual({ offer: found, sourceFolder: found });
    expect(l.clock.now()).toBe(before);
    expect(l.clock.pending()).toBe(0);
  });

  // @spec DESK-SHELL-FIRST-001
  it("never rejects, even when a drive look rejects", async () => {
    const found = sourceFolder();
    const remembered = sourceFolder();
    const fx = new FakeFacts();
    fx.isFixedDriveReply = () => Promise.reject(new Error("powershell failed"));
    const l = look(sourceAnswer(found, "off"), remembered, fx);
    await l.clock.advance(500);
    expect(l.result.done).toBe(true);
    expect(l.result.error).toBeUndefined();
    expect(l.result.value?.offer ?? null).not.toBe(found);
  });
});
