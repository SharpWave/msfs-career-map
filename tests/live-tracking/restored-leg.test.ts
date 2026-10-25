/**
 * A leg restored in the air after a server restart, with the sim link: it carries on when the link
 * reconnects (LIVE-LEG-012); the sim's connection ending before the first sample keeps it as
 * pending, ended in the air, while the server stopping the link leaves it restored in the final
 * checkpoint (LIVE-LEG-016).
 */
import { open } from "node-simconnect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startSimLink } from "../../src/server/simconnect.ts";
import { Tracker } from "../../src/server/tracker.ts";
import { FakeSimHandle, answerOpen, linkTracker, settle } from "./fake-sim.ts";
import { pilot, takeOff } from "./pilot.ts";
import { readCheckpoint, resetLogbook } from "./state.ts";

vi.mock("node-simconnect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node-simconnect")>()),
  open: vi.fn(),
}));

const PLANE = { title: "Test Plane", livery: "N1TP", atc_id: "N1TP" };
const base = { alt_ft: 55, gs_kts: 0, hdg_deg: 40, vs_fpm: 0, ias_kts: 0, g: 1, fuel_lb: 300, weight_lb: 2400, ...PLANE };

describe("a leg restored after a server restart", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  // @spec LIVE-LEG-012
  it("carries on when the sim link reconnects, instead of being discarded as an aircraft change", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));

    // Before the restart: on the ground at KPVD, then airborne long enough to start a leg and checkpoint it.
    const before = new Tracker();
    before.setConnected(true, "Fake MSFS");
    let lat = 41.7246;
    const lon = -71.4282;
    const step = (on_ground: boolean) => {
      before.feed({ t: Date.now(), lat, lon, on_ground, ...base, alt_ft: on_ground ? 55 : 1500, gs_kts: on_ground ? 0 : 100 });
      vi.advanceTimersByTime(1000);
      if (!on_ground) lat += 0.0005;
    };
    for (let i = 0; i < 3; i++) step(true);
    for (let i = 0; i < 12; i++) step(false);
    expect(before.status().leg?.origin).toBe("KPVD");

    // The restart: a new tracker from the checkpoint, and the sim link connecting afresh.
    const after = new Tracker();
    expect(after.status().phase).toBe("airborne");
    expect(after.status().leg?.origin).toBe("KPVD");

    const hd = new FakeSimHandle();
    vi.mocked(open).mockResolvedValueOnce({ recvOpen: { applicationName: "Fake MSFS" }, handle: hd } as never);
    const link = startSimLink(
      {
        onSample: (s) => after.feed(s),
        onConnect: (name) => after.setConnected(true, name),
        onDisconnect: () => after.setConnected(false),
        onLiveryUnsupported: () => after.setLiverySupported(false),
      },
      { retryMs: 60_000 },
    );
    try {
      await settle();
      // The position request answers before the livery request.
      hd.position({ lat, lon, alt_ft: 1500, on_ground: false, gs_kts: 100, ias_kts: 100, title: PLANE.title, atc_id: PLANE.atc_id });
      vi.advanceTimersByTime(1000);
      hd.livery(PLANE.livery);
      hd.position({ lat: lat + 0.0005, lon, alt_ft: 1500, on_ground: false, gs_kts: 100, ias_kts: 100, title: PLANE.title, atc_id: PLANE.atc_id });

      const st = after.status();
      expect(st.message ?? "").not.toMatch(/Discarded/);
      expect(st.phase).toBe("airborne");
      expect(st.leg?.origin).toBe("KPVD");
      expect(st.sim).toMatchObject({ title: PLANE.title, livery: PLANE.livery });
    } finally {
      link.stop();
    }
  });
});

describe("a leg restored in the air whose sim link ends before the first sample", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T11:59:00Z"));
    resetLogbook();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * An airborne leg from KPVD checkpointed, then a server restart: a new tracker restored from that
   * checkpoint and linked to the (fake) sim, which connects but sends no sample yet.
   */
  async function restoreAndLink() {
    const before = new Tracker();
    before.setConnected(true, "Fake MSFS");
    const p = pilot(before);
    takeOff(p);
    p.air(70);
    before.saveNow();
    const written = readCheckpoint()!;
    expect(written).toMatchObject({ phase: "airborne", leg: { origin: "KPVD" }, pending: [] });

    const after = new Tracker();
    expect(after.status().phase).toBe("airborne");
    const hd = new FakeSimHandle();
    answerOpen(hd);
    const link = linkTracker(after);
    await settle();
    expect(after.status().connected).toBe(true);
    return { written, after, hd, link };
  }

  // @spec LIVE-LEG-016
  it("stays restored in the final checkpoint when the server stops the link", async () => {
    const { written, after, hd, link } = await restoreAndLink();

    link.stop();
    hd.lose();
    await settle();
    after.shutdown({ quitting: false });

    const cp = readCheckpoint()!;
    expect(cp.phase).toBe("airborne");
    expect(cp.leg).toEqual(written.leg);
    expect(cp.pending).toEqual([]);

    const again = new Tracker().status();
    expect(again.phase).toBe("airborne");
    expect(again.leg).toMatchObject({ origin: "KPVD", departed_at: new Date(written.leg.departed_at).toISOString() });
    expect(again.pending).toEqual([]);
  });

  // @spec LIVE-LEG-016, LIVE-HOP-007
  it.each([
    ["the connection closes", (hd: FakeSimHandle) => hd.lose()],
    ["MSFS quits", (hd: FakeSimHandle) => hd.quit()],
  ])("is kept as pending, ended in the air and not resumed, when %s", async (_, end) => {
    const { written, after, hd, link } = await restoreAndLink();
    try {
      end(hd);
      await settle();

      const st = after.status();
      expect(st.connected).toBe(false);
      expect(st.leg).toBeNull();
      expect(st.pending).toHaveLength(1);
      expect(st.pending[0]).toMatchObject({
        origin: "KPVD",
        dest: null,
        departed_at: new Date(written.leg.departed_at).toISOString(),
        arrived_at: new Date(written.last.t).toISOString(),
        reason: "MSFS Career Map stopped in flight and the sim did not resume it",
        ended_in_air: true,
      });
    } finally {
      link.stop();
    }
  });
});
