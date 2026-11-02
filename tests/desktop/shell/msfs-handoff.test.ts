/**
 * A start by MSFS (src/desktop/msfs-handoff.ts): an installed `--background` start whose parent is MSFS
 * 2024 or MSFS 2020 and that gets the single-instance lock writes its shortcut, logs, lets go of the lock
 * and has Windows' shell start the app, never becoming the running copy (DESK-SHELL-CLI-023); with
 * another copy running it hands over (DESK-SHELL-CLI-003); any other parent, or none to be found, is an
 * ordinary `--background` start (DESK-SHELL-CLI-005, DESK-SHELL-CLI-024); and a shortcut or Explorer that
 * fails leaves this start running the app (DESK-SHELL-CLI-025). The lookup of the parent's program by
 * tasklist is in windows-facts.test.ts.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { backgroundStart, SHORTCUT_NAME, type HandoffPorts } from "../../../src/desktop/msfs-handoff.ts";

const LOCAL = "C:\\Users\\pilot\\AppData\\Local";
const ELECTRON = "C:\\Users\\pilot\\AppData\\Roaming\\MSFS Career Map";
const PROGRAM = "C:\\Users\\pilot\\AppData\\Local\\Programs\\MSFS Career Map\\MSFS Career Map.exe";
const SHORTCUT = path.win32.join(ELECTRON, "Start in the tray.lnk");
const PARENT = 33924;

/** Ports recording every call in order; each can be told how to answer. */
function ports(o: {
  parent?: string | null | Error;
  locks?: boolean[];
  shortcut?: Error;
  explorer?: { ok: true } | { ok: false; reason: string } | Error;
} = {}) {
  const calls: string[] = [];
  const lines: string[] = [];
  const locks = [...(o.locks ?? [true])];
  const p: HandoffPorts = {
    async programNameOf(pid) {
      calls.push(`look ${pid}`);
      if (o.parent instanceof Error) throw o.parent;
      return o.parent === undefined ? "FlightSimulator2024.exe" : o.parent;
    },
    takeLock() {
      const got = locks.shift() ?? false;
      calls.push(`lock ${got ? "taken" : "held elsewhere"}`);
      return got;
    },
    releaseLock() {
      calls.push("let go");
    },
    writeShortcut(file, target, args) {
      calls.push(`shortcut ${file} -> ${target} ${args}`);
      if (o.shortcut) throw o.shortcut;
    },
    async openInExplorer(file) {
      calls.push(`explorer ${file}`);
      if (o.explorer instanceof Error) throw o.explorer;
      return o.explorer ?? { ok: true };
    },
    log(line) {
      calls.push("log");
      lines.push(line);
    },
  };
  return { p, calls, lines };
}

const start = (p: HandoffPorts) => backgroundStart({ parentPid: PARENT, electronFolder: ELECTRON, localAppData: LOCAL, ports: p });

describe("a start by MSFS", () => {
  // @spec DESK-SHELL-CLI-023, DESK-SHELL-CLI-013
  it("writes its shortcut, logs, lets go of the lock, has Explorer start the app, and runs nothing itself", async () => {
    const { p, calls, lines } = ports();
    expect(await start(p)).toBe("handed-to-shell");
    expect(calls).toEqual([
      `look ${PARENT}`,
      "lock taken",
      `shortcut ${SHORTCUT} -> ${PROGRAM} --background`,
      "log",
      "let go",
      `explorer ${SHORTCUT}`,
    ]);
    expect(SHORTCUT_NAME).toBe("Start in the tray.lnk");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/started by MSFS.*Windows' shell/);
  });

  // @spec DESK-SHELL-CLI-023
  it("is told by MSFS 2024's or MSFS 2020's program, in any case", async () => {
    for (const parent of ["FlightSimulator2024.exe", "FlightSimulator.exe", "FLIGHTSIMULATOR2024.EXE", "flightsimulator.exe"]) {
      expect(await start(ports({ parent }).p), parent).toBe("handed-to-shell");
    }
  });

  // @spec DESK-SHELL-CLI-023, DESK-SHELL-CLI-003
  it("hands over to a copy already running, writing nothing and starting nothing", async () => {
    const { p, calls, lines } = ports({ locks: [false] });
    expect(await start(p)).toBe("handed-over");
    expect(calls).toEqual([`look ${PARENT}`, "lock held elsewhere"]);
    expect(lines).toEqual([]);
  });
});

describe("a --background start not by MSFS", () => {
  // @spec DESK-SHELL-CLI-005
  it("is an ordinary start when its parent is any other program", async () => {
    for (const parent of ["explorer.exe", "userinit.exe", "MSFS Career Map Setup 0.8.1.exe", "FlightSimulator2024Launcher.exe"]) {
      const { p, calls } = ports({ parent });
      expect(await start(p), parent).toBe("run");
      expect(calls).toEqual([`look ${PARENT}`, "lock taken"]);
    }
  });

  // @spec DESK-SHELL-CLI-024
  it("is an ordinary start when the parent's program cannot be looked up", async () => {
    for (const parent of [null, new Error("tasklist failed")]) {
      const { p, calls } = ports({ parent });
      expect(await start(p)).toBe("run");
      expect(calls).toEqual([`look ${PARENT}`, "lock taken"]);
    }
  });

  // @spec DESK-SHELL-CLI-024, DESK-SHELL-CLI-003
  it("hands over as usual when another copy runs", async () => {
    const { p } = ports({ parent: "explorer.exe", locks: [false] });
    expect(await start(p)).toBe("handed-over");
  });
});

describe("a start by MSFS that cannot hand over to Windows' shell", () => {
  // @spec DESK-SHELL-CLI-025
  it("runs the app itself, never having let go of the lock, when its shortcut cannot be written", async () => {
    const { p, calls, lines } = ports({ shortcut: new Error("EPERM: operation not permitted") });
    expect(await start(p)).toBe("run");
    expect(calls).not.toContain("let go");
    expect(calls.some((c) => c.startsWith("explorer"))).toBe(false);
    expect(lines.at(-1)).toContain("EPERM: operation not permitted");
  });

  // @spec DESK-SHELL-CLI-025
  it("takes the lock again and runs the app itself when Explorer cannot be started, saying why", async () => {
    for (const explorer of [{ ok: false as const, reason: "spawn explorer.exe ENOENT" }, new Error("spawn explorer.exe ENOENT")]) {
      const { p, calls, lines } = ports({ explorer, locks: [true, true] });
      expect(await start(p)).toBe("run");
      // The reason logged only once the lock is held again.
      expect(calls.slice(-3)).toEqual([`explorer ${SHORTCUT}`, "lock taken", "log"]);
      expect(lines.at(-1)).toContain("spawn explorer.exe ENOENT");
    }
  });

  // @spec DESK-SHELL-CLI-025, DESK-SHELL-CLI-003
  it("hands over to the copy that took the lock meanwhile, when Explorer cannot be started", async () => {
    const { p, calls, lines } = ports({ explorer: { ok: false, reason: "failed" }, locks: [true, false] });
    expect(await start(p)).toBe("handed-over");
    expect(calls.at(-1)).toBe("lock held elsewhere");
    // Only the line written while it held the lock: the copy now running owns desktop.log.
    expect(lines).toHaveLength(1);
  });
});
