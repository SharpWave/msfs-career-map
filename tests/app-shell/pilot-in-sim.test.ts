/**
 * The check the server's startup hands airports' refresh (APP-SRV-012): this server's sim link
 * connected, or the tracker holding a leg in progress, both from the tracker's status, with a notice
 * whenever that changes.
 */
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { pilotInSim } from "../../src/server/tracking.ts";

/** A tracker as pilotInSim sees it: a status, and "status" events carrying it. */
function fakeTracker(init: { sim_mode: "link" | "fake" | "off"; connected: boolean; leg: object | null }) {
  const t = new EventEmitter() as EventEmitter & { status(): typeof init };
  let s = { ...init };
  t.status = () => s;
  return {
    tracker: t,
    set(change: Partial<typeof init>) {
      s = { ...s, ...change };
      t.emit("status", s);
    },
  };
}

describe("pilotInSim (APP-SRV-012)", () => {
  // @spec APP-SRV-012, APT-DATA-004
  it("reports the pilot in the sim while the sim link is connected, in the menus or in casual mode alike", () => {
    const f = fakeTracker({ sim_mode: "link", connected: false, leg: null });
    const check = pilotInSim(f.tracker as never);
    expect(check.now()).toBe(false);
    f.set({ connected: true });
    expect(check.now()).toBe(true);
  });

  // @spec APP-SRV-012, APT-DATA-004
  it("reports the pilot in the sim while the tracker holds a leg, a restored one with the link down included", () => {
    const f = fakeTracker({ sim_mode: "link", connected: false, leg: { stats: {} } });
    expect(pilotInSim(f.tracker as never).now()).toBe(true);
  });

  // @spec APP-SRV-012, APT-DATA-004
  it("never counts the fake feed as a connected sim link, only a leg it drives", () => {
    const f = fakeTracker({ sim_mode: "fake", connected: true, leg: null });
    const check = pilotInSim(f.tracker as never);
    expect(check.now()).toBe(false);
    f.set({ leg: { stats: {} } });
    expect(check.now()).toBe(true);
  });

  // @spec APP-SRV-012
  it("tells its listener only when the answer changes, and no more once unsubscribed", () => {
    const f = fakeTracker({ sim_mode: "link", connected: false, leg: null });
    const check = pilotInSim(f.tracker as never);
    const heard = vi.fn();
    const off = check.onChange(heard);
    f.set({ connected: false });
    expect(heard).not.toHaveBeenCalled();
    f.set({ connected: true });
    f.set({ leg: { stats: {} } });
    expect(heard).toHaveBeenCalledTimes(1);
    f.set({ connected: false, leg: null });
    expect(heard).toHaveBeenCalledTimes(2);
    off();
    f.set({ connected: true });
    expect(heard).toHaveBeenCalledTimes(2);
    expect(f.tracker.listenerCount("status")).toBe(0);
  });
});
