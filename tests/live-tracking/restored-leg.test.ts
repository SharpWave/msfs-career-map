import { open } from "node-simconnect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startSimLink } from "../../src/server/simconnect.ts";
import { Tracker } from "../../src/server/tracker.ts";
import { FakeSimHandle, settle } from "./fake-sim.ts";

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
