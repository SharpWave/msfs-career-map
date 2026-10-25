/**
 * Finding and closing the app's running copy (build/installer-steps.nsh `${CareerMapFindRunning}`,
 * `${CareerMapCloseRunning}`; m3 contract §4.2, §4.3): the running copy is every process of this user
 * whose program lies inside the install folder — the desktop shell and its server's utility process,
 * both `MSFS Career Map.exe` there — while a program of the same name started anywhere else is left
 * alone, and the installer's own process is never counted. Closing runs `"<program>" --quit` without
 * waiting, then waits for every such process to end by itself, ending any left once the wait is over.
 *
 * The stand-in install folder plays the install folder; the fake app (support/nsis.ts) plays the app:
 * started twice from `install\` and once from `elsewhere\`. Each closing program first checks that
 * FindRunning counts exactly the two copies in `install\` and closes nothing otherwise, so a step that
 * matched the wrong processes cannot end anything on this PC beyond the stand-ins.
 */
import { describe, expect, it } from "vitest";
import { useStandIns } from "./support/harness.ts";
import {
  type StandIns,
  type Started,
  buildProgram,
  fakeApp,
  processesIn,
  run,
  start,
  startedWith,
  value,
  waitFor,
} from "./support/nsis.ts";

const standIns = useStandIns();

const WAIT_MS = 5000;

/** Two copies of the fake app running from `install\` (the shell and its utility process) and one from `elsewhere\`. */
async function runningCopies(
  s: StandIns,
  opts: { ignoreQuit?: boolean } = {},
): Promise<{ installed: Started[]; other: Started }> {
  const app = await fakeApp(s, s.install, opts);
  const elsewhere = await fakeApp(s, s.elsewhere);
  const installed = [start(app, s), start(app, s)];
  const other = start(elsewhere, s);
  const up = await waitFor(() => processesIn(s.install).length === 2 && processesIn(s.elsewhere).length === 1, 30_000, 200);
  expect(up, "the fake apps are running").toBe(true);
  return { installed, other };
}

/** A program closing the copy in `install\` with WAIT_MS, but only when FindRunning counts `expected` there. */
function closeBody(expected: number): string {
  return `  \${CareerMapFindRunning} $0 "\${INSTALL}"
  \${Out} "before=$0"
  \${If} $0 = ${expected}
    \${Ticks} $8
    \${CareerMapCloseRunning} $1 "\${INSTALL}" "\${PROGRAM}" ${WAIT_MS}
    \${Ticks} $9
    IntOp $9 $9 - $8
    \${Out} "result=$1"
    \${Out} "ms=$9"
    \${CareerMapFindRunning} $2 "\${INSTALL}"
    \${Out} "after=$2"
  \${Else}
    \${Out} "result=not closed: FindRunning counted $0"
  \${EndIf}`;
}

describe("CareerMapFindRunning", () => {
  // @spec DESK-DIST-INST-011, DESK-DIST-INCL-001
  it("counts the processes whose program lies inside the folder, ignoring case, and nothing else", async () => {
    const s = standIns();
    const { installed, other } = await runningCopies(s);
    const exe = await buildProgram(
      s,
      "find",
      `  \${CareerMapFindRunning} $0 "\${INSTALL}"
  \${Out} "install=$0"
  \${CareerMapFindRunning} $0 "${s.install.toUpperCase()}"
  \${Out} "upper=$0"
  \${CareerMapFindRunning} $0 "${s.install.toLowerCase()}"
  \${Out} "lower=$0"
  \${CareerMapFindRunning} $0 "\${ELSEWHERE}"
  \${Out} "elsewhere=$0"
  \${CareerMapFindRunning} $0 "\${ROOT}\\instal"
  \${Out} "prefix=$0"
  \${CareerMapFindRunning} $0 "\${INSTALL}\\resources"
  \${Out} "sub=$0"
  \${CareerMapFindRunning} $0 "\${WORK}"
  \${Out} "own=$0"`,
    );
    const { out } = await run(exe, s);
    expect({
      install: value(out, "install"),
      upper: value(out, "upper"),
      lower: value(out, "lower"),
      elsewhere: value(out, "elsewhere"),
      prefix: value(out, "prefix"),
      sub: value(out, "sub"),
      own: value(out, "own"),
    }).toEqual({ install: "2", upper: "2", lower: "2", elsewhere: "1", prefix: "0", sub: "0", own: "0" });
    // Finding ends nothing.
    expect([...installed, other].map((p) => p.running())).toEqual([true, true, true]);
  });
});

describe("CareerMapCloseRunning", () => {
  // @spec DESK-DIST-INST-011, DESK-DIST-INST-015, DESK-DIST-INST-016, DESK-DIST-INCL-001
  it("runs the program with --quit and gives 'quit' once every copy inside the folder has exited by itself", async () => {
    const s = standIns();
    const { installed, other } = await runningCopies(s);
    const { out } = await run(await buildProgram(s, "close-quit", closeBody(2)), s);
    expect(value(out, "before")).toBe("2");
    expect(value(out, "result")).toBe("quit");
    expect(Number(value(out, "ms")), "closed well before the wait was over").toBeLessThan(WAIT_MS - 1000);
    expect(value(out, "after")).toBe("0");
    // Both exited by themselves (the fake app exits 0 once `quit-asked` exists), after a `--quit` start.
    expect(await Promise.all(installed.map((p) => p.exited(10_000)))).toEqual([0, 0]);
    expect(startedWith(s.install)).toContain("--quit");
    // The program of the same name elsewhere is left running and was never asked to quit.
    expect(other.running()).toBe(true);
    expect(processesIn(s.elsewhere)).toEqual([other.pid]);
    expect(startedWith(s.elsewhere)).not.toContain("--quit");
  });

  // @spec DESK-DIST-INST-011, DESK-DIST-INST-015, DESK-DIST-INST-016, DESK-DIST-INCL-001
  it("ends the copies inside the folder still running once the wait is over and gives 'ended'", async () => {
    const s = standIns();
    const { installed, other } = await runningCopies(s, { ignoreQuit: true });
    const { out } = await run(await buildProgram(s, "close-ended", closeBody(2)), s);
    expect(value(out, "before")).toBe("2");
    expect(value(out, "result")).toBe("ended");
    const ms = Number(value(out, "ms"));
    expect(ms, "waited the whole wait").toBeGreaterThanOrEqual(WAIT_MS - 500);
    expect(ms, "and not much longer").toBeLessThan(WAIT_MS + 10_000);
    expect(value(out, "after")).toBe("0");
    expect(startedWith(s.install)).toContain("--quit");
    expect((await Promise.all(installed.map((p) => p.exited(10_000)))).includes("running")).toBe(false);
    expect(processesIn(s.install)).toEqual([]);
    expect(other.running()).toBe(true);
    expect(processesIn(s.elsewhere)).toEqual([other.pid]);
  });

  // @spec DESK-DIST-INST-011, DESK-DIST-INST-015, DESK-DIST-INCL-001
  it("gives 'none' and runs nothing when no copy runs inside the folder", async () => {
    const s = standIns();
    await fakeApp(s, s.install);
    const elsewhere = await fakeApp(s, s.elsewhere);
    const other = start(elsewhere, s);
    expect(await waitFor(() => processesIn(s.elsewhere).length === 1, 30_000, 200)).toBe(true);
    const { out } = await run(await buildProgram(s, "close-none", closeBody(0)), s);
    expect(value(out, "before")).toBe("0");
    expect(value(out, "result")).toBe("none");
    expect(value(out, "after")).toBe("0");
    // The installed program was never started, not even with --quit.
    expect(startedWith(s.install)).toEqual([]);
    expect(other.running()).toBe(true);
    expect(startedWith(s.elsewhere)).not.toContain("--quit");
  });
});
