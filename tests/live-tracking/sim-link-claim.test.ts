/**
 * The PC-wide sim-link claim (LIVE-LINK-010, 014, 015, 001; its release, LIVE-LINK-011; the
 * status's `link_holder`, LIVE-API-013): a named pipe a server on the sim link to a sim on this PC
 * holds from SimConnect opening until the connection ends or the link stops, answering each check
 * with one JSON line naming who holds it and its data folder. Another server's claim keeps the link
 * from opening SimConnect, checked again at each retry; a holder that gives no answer within 1 s
 * counts as one that does not say who it is.
 *
 * No test opens the PC-wide pipe (`\\.\pipe\msfs-career-map-sim-link`): each passes startTracking a
 * private `claimPipe` and plays any other holder itself on that name.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { open } from "node-simconnect";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { SIM_LINK_PIPE } from "../../src/server/sim-link-claim.ts";
import { Tracker, type SimMode } from "../../src/server/tracker.ts";
import { startTracking, type Tracking } from "../../src/server/tracking.ts";
import { FakeSimHandle, answerOpen, settle } from "./fake-sim.ts";
import { resetLogbook } from "./state.ts";

vi.mock("node-simconnect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node-simconnect")>()),
  open: vi.fn(),
}));

const FOLDER = "C:\\Users\\Pilot\\AppData\\Roaming\\MSFS Career Map";
const answer = (o: Record<string, unknown>) => JSON.stringify(o) + "\n";
const INSTALLED = answer({ app: "msfs-career-map", holder: "installed", data_folder: "D:\\Career" });
const SOURCE = answer({ app: "msfs-career-map", holder: "source", data_folder: "C:\\dev\\career\\data" });

const privatePipe = () => `\\\\.\\pipe\\msfs-career-map-sim-link-test-${process.pid}-${randomUUID()}`;
const realWait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Wait, in real time, until `cond` holds (or fail after `ms`). */
async function until(cond: () => boolean, ms = 3000, what = "the condition"): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await realWait(10);
  }
}

/**
 * Another holder of the claim, played by the test on `pipe`: each check gets `reply` (a string),
 * a connection closed with no answer ("close"), or no answer at all (null, the connection left open).
 */
async function otherHolder(pipe: string, reply: string | "close" | null) {
  let checks = 0;
  const open = new Set<net.Socket>();
  const server = net.createServer((sock) => {
    checks++;
    open.add(sock);
    sock.on("close", () => open.delete(sock));
    sock.on("error", () => {});
    if (reply === "close") sock.destroy();
    else if (reply !== null) sock.end(reply);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(pipe, () => resolve());
  });
  holders.push(server);
  return {
    checks: () => checks,
    close: () =>
      new Promise<void>((resolve) => {
        for (const s of open) s.destroy();
        server.close(() => resolve());
      }),
  };
}

/** Check the pipe as another server would: its answer, or the error code connecting gives. */
function ask(pipe: string): Promise<{ answer: string } | { code: string }> {
  return new Promise((resolve) => {
    const sock = net.connect(pipe);
    let text = "";
    const timer = setTimeout(() => {
      sock.destroy();
      resolve({ code: "TIMEOUT" });
    }, 2000);
    sock.setEncoding("utf8");
    sock.on("data", (d) => (text += d));
    sock.on("end", () => {
      clearTimeout(timer);
      resolve({ answer: text });
    });
    sock.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve({ code: e.code ?? "ERROR" });
    });
  });
}

let holders: net.Server[] = [];
let started: Tracking[] = [];
let logs: MockInstance<typeof console.log>;
const simLines = () => logs.mock.calls.map((args) => args.map(String).join(" ")).filter((l) => l.startsWith("[sim]"));

function start(
  tr: Tracker,
  pipe: string,
  o: { sim?: SimMode; simHost?: string | null; retryMs?: number; holder?: "installed" | "source"; dataFolder?: string } = {},
): Tracking {
  const t = startTracking(tr, {
    sim: "link",
    simHost: null,
    simPort: null,
    retryMs: 60_000,
    holder: "source",
    dataFolder: FOLDER,
    ...o,
    claimPipe: pipe,
  });
  started.push(t);
  return t;
}

beforeEach(() => {
  vi.mocked(open).mockReset();
  vi.mocked(open).mockImplementation(() => new Promise(() => {}) as never);
  resetLogbook();
  logs = vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(async () => {
  for (const t of started) t.stop();
  started = [];
  await Promise.all(holders.map((s) => new Promise<void>((r) => s.close(() => r()))));
  holders = [];
  logs.mockRestore();
});

describe("the claim's pipe", () => {
  // @spec LIVE-LINK-010
  it("is the named pipe every process on the PC sees", () => {
    expect(SIM_LINK_PIPE).toBe("\\\\.\\pipe\\msfs-career-map-sim-link");
  });
});

describe("holding the claim (LIVE-LINK-010)", () => {
  // @spec LIVE-LINK-010, LIVE-API-013
  it.each<["installed" | "source"]>([["installed"], ["source"]])(
    "takes it once SimConnect opens and answers each check with one JSON line naming the holder (%s) and its data folder",
    async (holder) => {
      const pipe = privatePipe();
      const tr = new Tracker();
      answerOpen(new FakeSimHandle());
      start(tr, pipe, { holder });
      await until(() => tr.status().connected, 3000, "the link to connect");

      for (let i = 0; i < 2; i++) {
        const got = await ask(pipe);
        expect(got).toHaveProperty("answer");
        const text = (got as { answer: string }).answer;
        expect(text.endsWith("\n")).toBe(true);
        expect(text.trim().split("\n")).toHaveLength(1);
        expect(JSON.parse(text)).toEqual({ app: "msfs-career-map", holder, data_folder: FOLDER });
      }
      expect(tr.status().link_holder).toBeNull();
    },
  );

  // @spec LIVE-LINK-010
  it("holds nothing while SimConnect has not opened (the sim not running, or still loading)", async () => {
    const pipe = privatePipe();
    const tr = new Tracker();
    start(tr, pipe); // every attempt waits forever
    await until(() => vi.mocked(open).mock.calls.length === 1, 3000, "the first attempt");
    await realWait(50);
    expect(await ask(pipe)).toEqual({ code: "ENOENT" });
    expect(tr.status().connected).toBe(false);
  });

  // @spec LIVE-LINK-010, LIVE-LINK-001
  it("holds nothing after an attempt that fails, and tries again", async () => {
    const pipe = privatePipe();
    vi.mocked(open).mockRejectedValueOnce(new Error("no sim here"));
    const tr = new Tracker();
    start(tr, pipe, { retryMs: 30 });
    await until(() => vi.mocked(open).mock.calls.length >= 2, 3000, "a second attempt");
    expect(await ask(pipe)).toEqual({ code: "ENOENT" });
    expect(simLines().filter((l) => /no sim here/.test(l))).toHaveLength(1);
  });

  // @spec LIVE-LINK-010
  it.each<[string, (hd: FakeSimHandle) => void]>([
    ["the sim quits", (hd) => hd.quit()],
    ["the connection closes", (hd) => hd.lose()],
    ["the connection fails", (hd) => hd.fail()],
  ])("releases it at once when %s", async (_what, end) => {
    const pipe = privatePipe();
    const tr = new Tracker();
    const hd = new FakeSimHandle();
    answerOpen(hd);
    start(tr, pipe);
    await until(() => tr.status().connected, 3000, "the link to connect");
    expect(await ask(pipe)).toHaveProperty("answer");

    end(hd);
    expect(tr.status().connected).toBe(false);
    await realWait(20);
    expect(await ask(pipe)).toEqual({ code: "ENOENT" });
  });

  // @spec LIVE-LINK-011, LIVE-LINK-010
  it("releases it at once when the link stops, the tracker told nothing", async () => {
    const pipe = privatePipe();
    const tr = new Tracker();
    answerOpen(new FakeSimHandle());
    const t = start(tr, pipe);
    await until(() => tr.status().connected, 3000, "the link to connect");
    expect(await ask(pipe)).toHaveProperty("answer");

    t.stop();
    await realWait(20);
    expect(await ask(pipe)).toEqual({ code: "ENOENT" });
    expect(tr.status().connected).toBe(true);
  });

  // @spec LIVE-LINK-010, LIVE-LINK-014
  it("takes it again on the next connection, checking it is free first", async () => {
    const pipe = privatePipe();
    const tr = new Tracker();
    const first = new FakeSimHandle();
    const second = new FakeSimHandle();
    answerOpen(first, second);
    start(tr, pipe, { retryMs: 30 });
    await until(() => tr.status().connected, 3000, "the link to connect");
    first.lose();
    await until(() => tr.status().connected, 3000, "the link to connect again");
    expect(vi.mocked(open)).toHaveBeenCalledTimes(2);
    expect(await ask(pipe)).toHaveProperty("answer");
  });
});

describe("another server holding the claim (LIVE-LINK-014, LIVE-API-013)", () => {
  // @spec LIVE-LINK-014, LIVE-API-013
  it.each<[string, string, { holder: "installed" | "source" | null; data_folder: string | null; text: string }]>([
    ["the installed app", INSTALLED, { holder: "installed", data_folder: "D:\\Career", text: "The sim is linked to another copy (the installed app)" }],
    ["a copy run from source", SOURCE, { holder: "source", data_folder: "C:\\dev\\career\\data", text: "The sim is linked to another copy (run from source)" }],
    [
      "a holder of ours naming no known holder",
      answer({ app: "msfs-career-map", holder: "someone", data_folder: "E:\\Other" }),
      { holder: null, data_folder: "E:\\Other", text: "The sim is linked to another copy" },
    ],
    [
      "a holder of ours giving no data folder",
      answer({ app: "msfs-career-map", holder: "installed" }),
      { holder: "installed", data_folder: null, text: "The sim is linked to another copy (the installed app)" },
    ],
    ["something answering what is not JSON", "hello\n", { holder: null, data_folder: null, text: "The sim is linked to another copy" }],
    [
      "something answering another program's JSON",
      answer({ app: "something-else", holder: "installed", data_folder: "D:\\Career" }),
      { holder: null, data_folder: null, text: "The sim is linked to another copy" },
    ],
  ])("opens no SimConnect connection while %s holds it, and reports that holder", async (_who, reply, expected) => {
    const pipe = privatePipe();
    await otherHolder(pipe, reply);
    const tr = new Tracker();
    start(tr, pipe);
    await until(() => tr.status().link_holder !== null, 3000, "the holder to be reported");
    expect(tr.status().link_holder).toEqual(expected);
    await realWait(50);
    expect(open).not.toHaveBeenCalled();
    expect(tr.status().connected).toBe(false);
  });

  // @spec LIVE-LINK-014, LIVE-API-013
  it("counts a holder that closes the check with no answer as one that does not say who it is", async () => {
    const pipe = privatePipe();
    await otherHolder(pipe, "close");
    const tr = new Tracker();
    start(tr, pipe);
    await until(() => tr.status().link_holder !== null, 3000, "the holder to be reported");
    expect(tr.status().link_holder).toEqual({ holder: null, data_folder: null, text: "The sim is linked to another copy" });
    expect(open).not.toHaveBeenCalled();
  });

  // @spec LIVE-LINK-014, LIVE-API-013
  it("counts a holder that accepts the check but gives no answer within 1 s as one that does not say who it is", async () => {
    const pipe = privatePipe();
    await otherHolder(pipe, null);
    const tr = new Tracker();
    const began = Date.now();
    start(tr, pipe);
    await realWait(700);
    expect(tr.status().link_holder).toBeNull();
    expect(open).not.toHaveBeenCalled();
    await until(() => tr.status().link_holder !== null, 2500, "the silent holder to be reported");
    expect(Date.now() - began).toBeGreaterThanOrEqual(950);
    expect(tr.status().link_holder).toEqual({ holder: null, data_folder: null, text: "The sim is linked to another copy" });
    await realWait(50);
    expect(open).not.toHaveBeenCalled();
  });

  // @spec LIVE-LINK-014, LIVE-LINK-001
  it("checks again at each retry, writing the holder once, and connects once the holder lets go", async () => {
    const pipe = privatePipe();
    const other = await otherHolder(pipe, INSTALLED);
    const tr = new Tracker();
    answerOpen(new FakeSimHandle());
    start(tr, pipe, { retryMs: 40 });
    await until(() => other.checks() >= 3, 3000, "three checks");
    expect(open).not.toHaveBeenCalled();
    expect(simLines().filter((l) => l.includes("linked to another copy"))).toHaveLength(1);

    await other.close();
    await until(() => tr.status().connected, 3000, "the link to connect");
    expect(open).toHaveBeenCalledTimes(1);
    expect(tr.status().link_holder).toBeNull();
    // Now this server holds it.
    const got = await ask(pipe);
    expect(JSON.parse((got as { answer: string }).answer)).toMatchObject({ app: "msfs-career-map", holder: "source" });
  });

  // @spec LIVE-LINK-014, LIVE-API-013
  it("sends the status when the holder is first reported and when it lets go", async () => {
    const pipe = privatePipe();
    const other = await otherHolder(pipe, SOURCE);
    const tr = new Tracker();
    const sent: unknown[] = [];
    tr.on("status", (s: { link_holder: unknown }) => sent.push(s.link_holder));
    start(tr, pipe, { retryMs: 40 });
    await until(() => sent.some((h) => h !== null), 3000, "a status naming the holder");
    await other.close();
    await until(() => sent.at(-1) === null && vi.mocked(open).mock.calls.length > 0, 3000, "a status with no holder");
  });

  // @spec LIVE-LINK-014
  it("closes a connection that opened while another server took the claim, passing nothing to the tracker, and waits on that holder", async () => {
    const pipe = privatePipe();
    const hd = new FakeSimHandle();
    let other: Awaited<ReturnType<typeof otherHolder>> | null = null;
    vi.mocked(open).mockImplementationOnce((async () => {
      // Another server takes the claim between this server's check and SimConnect opening.
      other = await otherHolder(pipe, INSTALLED);
      return { recvOpen: { applicationName: "Fake MSFS" }, handle: hd };
    }) as never);
    const tr = new Tracker();
    const before = tr.status();
    const events: string[] = [];
    for (const e of ["status", "track", "point", "pending", "hop"]) tr.on(e, () => events.push(e));
    start(tr, pipe, { retryMs: 40 });
    await until(() => hd.close.mock.calls.length > 0, 3000, "the connection to be closed");

    // The closed handle was given no data definition or request, and its late close reaches nothing.
    expect(hd.addToDataDefinition).not.toHaveBeenCalled();
    hd.lose();
    hd.quit();
    await settle();
    expect(tr.status()).toMatchObject({ connected: false, sim_name: null, position: null, phase: before.phase });
    expect(events.filter((e) => e !== "status")).toEqual([]);
    expect(hd.requestDataOnSimObject).not.toHaveBeenCalled();

    await until(() => tr.status().link_holder !== null, 3000, "the holder to be reported");
    expect(tr.status().link_holder).toMatchObject({ holder: "installed" });
    expect(other!.checks()).toBeGreaterThanOrEqual(1);
    expect(open).toHaveBeenCalledTimes(1);
  });

  // @spec LIVE-LINK-014, LIVE-LINK-010
  it("checks the claim for a sim host that names this PC", async () => {
    const pipe = privatePipe();
    await otherHolder(pipe, INSTALLED);
    const tr = new Tracker();
    start(tr, pipe, { simHost: "127.0.0.1" });
    await until(() => tr.status().link_holder !== null, 3000, "the holder to be reported");
    expect(open).not.toHaveBeenCalled();
  });
});

describe("no claim off the sim link to this PC (LIVE-LINK-015)", () => {
  // @spec LIVE-LINK-015, LIVE-API-013
  it("neither checks nor takes the claim for a sim on another PC, and reports no holder", async () => {
    const pipe = privatePipe();
    const other = await otherHolder(pipe, INSTALLED);
    const tr = new Tracker();
    answerOpen(new FakeSimHandle());
    start(tr, pipe, { simHost: "192.0.2.20" });
    await until(() => tr.status().connected, 3000, "the link to connect");
    expect(other.checks()).toBe(0);
    expect(tr.status()).toMatchObject({ link_holder: null, sim_host: "192.0.2.20" });

    await other.close();
    await realWait(20);
    expect(await ask(pipe)).toEqual({ code: "ENOENT" });
  });

  // @spec LIVE-LINK-015, LIVE-API-013
  it.each<SimMode>(["fake", "off"])("neither checks nor takes the claim in sim mode %s, and reports no holder", async (sim) => {
    const pipe = privatePipe();
    const other = await otherHolder(pipe, INSTALLED);
    const tr = new Tracker();
    start(tr, pipe, { sim });
    await realWait(100);
    expect(other.checks()).toBe(0);
    expect(tr.status().link_holder).toBeNull();
    await other.close();

    const free = privatePipe();
    const tr2 = new Tracker();
    start(tr2, free, { sim });
    await realWait(50);
    expect(await ask(free)).toEqual({ code: "ENOENT" });
  });

  // @spec LIVE-TOOL-004, LIVE-LINK-015
  it("leaves sim-probe on the link module alone, which neither takes nor checks the claim", () => {
    const probe = fs.readFileSync(path.resolve(import.meta.dirname, "../../scripts/sim-probe.ts"), "utf8");
    expect(probe).toMatch(/from "\.\.\/src\/server\/simconnect\.ts"/);
    expect(probe).not.toMatch(/sim-link-claim|tracking\.ts|startTracking/);
    const link = fs.readFileSync(path.resolve(import.meta.dirname, "../../src/server/simconnect.ts"), "utf8");
    expect(link).not.toMatch(/sim-link-claim|msfs-career-map-sim-link|node:net/);
  });
});
