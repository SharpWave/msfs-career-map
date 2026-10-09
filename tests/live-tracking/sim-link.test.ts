import { open } from "node-simconnect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startSimLink, type SimSample } from "../../src/server/simconnect.ts";
import { FakeSimHandle, settle } from "./fake-sim.ts";

vi.mock("node-simconnect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node-simconnect")>()),
  open: vi.fn(),
}));

function handlers() {
  return {
    samples: [] as SimSample[],
    onSample: vi.fn(),
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    onLiveryUnsupported: vi.fn(),
  };
}

/** Start the link against a fake sim connection and wait until it has connected. */
async function connect(h: ReturnType<typeof handlers>, ...fakes: FakeSimHandle[]) {
  for (const hd of fakes) vi.mocked(open).mockResolvedValueOnce({ recvOpen: { applicationName: "Fake MSFS" }, handle: hd } as never);
  h.onSample.mockImplementation((s: SimSample) => h.samples.push(s));
  const link = startSimLink(h, { retryMs: 10 });
  await settle();
  expect(h.onConnect).toHaveBeenCalledTimes(1);
  return link;
}

describe("the sim link before the livery is read", () => {
  let link: { stop(): void } | null = null;
  beforeEach(() => {
    vi.mocked(open).mockReset();
  });
  afterEach(() => {
    link?.stop();
    link = null;
    vi.useRealTimers();
  });

  // @spec LIVE-LEG-012
  it("holds samples until the livery arrives, then passes them on in order with it", async () => {
    const h = handlers();
    const hd = new FakeSimHandle();
    link = await connect(h, hd);

    hd.position({ lat: 41.70 });
    hd.position({ lat: 41.71 });
    expect(h.onSample).not.toHaveBeenCalled();

    hd.livery("N123AB");
    expect(h.samples.map((s) => [s.lat, s.livery])).toEqual([
      [41.70, "N123AB"],
      [41.71, "N123AB"],
    ]);

    hd.position({ lat: 41.72 });
    expect(h.samples.map((s) => [s.lat, s.livery])).toEqual([
      [41.70, "N123AB"],
      [41.71, "N123AB"],
      [41.72, "N123AB"],
    ]);
  });

  // @spec LIVE-LEG-012, LIVE-LINK-005
  it("passes held samples on with a blank livery when the sim rejects the livery variable", async () => {
    const h = handlers();
    const hd = new FakeSimHandle();
    link = await connect(h, hd);

    hd.position({ lat: 41.70 });
    expect(h.onSample).not.toHaveBeenCalled();
    hd.rejectLivery();
    expect(h.onLiveryUnsupported).toHaveBeenCalledTimes(1);
    expect(h.samples.map((s) => [s.lat, s.livery])).toEqual([[41.70, ""]]);

    hd.position({ lat: 41.71 });
    expect(h.samples.map((s) => s.livery)).toEqual(["", ""]);
  });

  // @spec LIVE-LEG-012
  it("holds samples again on every new connection", async () => {
    const h = handlers();
    const first = new FakeSimHandle();
    const second = new FakeSimHandle();
    link = await connect(h, first, second);
    first.livery("N123AB");
    first.position({ lat: 41.70 });
    expect(h.samples).toHaveLength(1);

    first.emit("close");
    expect(h.onDisconnect).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(h.onConnect).toHaveBeenCalledTimes(2));

    second.position({ lat: 41.71 });
    expect(h.samples).toHaveLength(1);
    second.livery("N456CD");
    expect(h.samples.map((s) => [s.lat, s.livery])).toEqual([
      [41.70, "N123AB"],
      [41.71, "N456CD"],
    ]);
  });

  // @spec LIVE-LINK-009
  it("passes samples on with a blank livery when the livery has not come 5 s after the first held sample", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
    const h = handlers();
    const hd = new FakeSimHandle();
    link = await connect(h, hd);

    hd.position({ lat: 41.70 });
    await vi.advanceTimersByTimeAsync(3000);
    hd.position({ lat: 41.71 });
    expect(h.onSample).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2100);
    hd.position({ lat: 41.72 });
    expect(h.samples.map((s) => [s.lat, s.livery])).toEqual([
      [41.70, ""],
      [41.71, ""],
      [41.72, ""],
    ]);
    // Held samples keep the time they arrived.
    expect(h.samples[1].t - h.samples[0].t).toBe(3000);

    hd.livery("N123AB");
    hd.position({ lat: 41.73 });
    expect(h.samples.at(-1)?.livery).toBe("N123AB");
  });
});
