/**
 * The page's tracker stream (useTracker): the casual path from the whole-path and next-point events
 * (LIVE-API-011, LIVE-API-005), the logged hop's record handed to the page from a `hop` event
 * carrying the hop and its message (LIVE-API-014, LIVE-CARD-009), and the stream opened again 3 s
 * after it ends (LIVE-API-005).
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTracker } from "../../src/client/tracker.ts";
import { hop, trackerStatus } from "../support/page-data.ts";

/** Stands in for the browser's EventSource so the test can play the server's events. */
class FakeEventSource {
  static last: FakeEventSource;
  /** Every source made, oldest first. */
  static all: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, ((e: MessageEvent<string>) => void)[]>();
  constructor(public url: string) {
    FakeEventSource.last = this;
    FakeEventSource.all.push(this);
  }
  addEventListener(name: string, fn: (e: MessageEvent<string>) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
  }
  close() {
    this.closed = true;
  }
  play(name: string, data: unknown) {
    for (const fn of this.listeners.get(name) ?? []) fn(new MessageEvent(name, { data: JSON.stringify(data) }));
  }
}

/** The sources made and not closed. */
const openSources = () => FakeEventSource.all.filter((es) => !es.closed);

const pt = (lat: number, lon: number, s: number) => [lat, lon, 1500, s, 100, 0, 100, 300];

describe("the page's tracker stream", () => {
  beforeEach(() => {
    FakeEventSource.all = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // @spec LIVE-API-011, LIVE-API-005
  it("keeps the casual path from the whole-path events and adds each next point to the last segment", () => {
    const { result } = renderHook(() => useTracker(() => {}));
    const es = FakeEventSource.last;
    expect(result.current.path).toEqual([]);

    act(() => es.play("path", [[pt(41, -71, 100)]]));
    expect(result.current.path).toEqual([[pt(41, -71, 100)]]);

    act(() => es.play("path-point", pt(41.01, -71, 105)));
    act(() => es.play("path-point", pt(41.02, -71, 110)));
    expect(result.current.path).toEqual([[pt(41, -71, 100), pt(41.01, -71, 105), pt(41.02, -71, 110)]]);

    act(() => es.play("path", [[pt(41, -71, 100), pt(41.01, -71, 105), pt(41.02, -71, 110)], [pt(45, -70, 200)]]));
    act(() => es.play("path-point", pt(45.01, -70, 205)));
    expect(result.current.path).toHaveLength(2);
    expect(result.current.path[1]).toEqual([pt(45, -70, 200), pt(45.01, -70, 205)]);

    // A reconnect resends everything, and switching off or clearing sends an empty path.
    act(() => es.play("path", []));
    expect(result.current.path).toEqual([]);
  });

  // @spec LIVE-API-014, LIVE-CARD-009
  it("hands the page the logged hop's record from a hop event carrying the hop and its message", () => {
    const onHop = vi.fn();
    renderHook(() => useTracker(onHop));
    const es = FakeEventSource.last;
    const logged = hop({ id: 7, aircraft_id: 1, origin: "KHYA", dest: "KACK", departed_at: "2026-10-10T09:15:00.000Z", arrived_at: "2026-10-10T09:55:00.000Z", duration_min: 40 });

    act(() => es.play("hop", { hop: logged, message: "Logged KHYA → KACK, 40 min" }));
    expect(onHop).toHaveBeenCalledTimes(1);
    expect(onHop).toHaveBeenCalledWith(logged);
  });

  // @spec LIVE-API-005
  it("closes the stream and goes offline when it ends", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTracker(() => {}));
    const es = FakeEventSource.last;
    expect(es.url).toBe("/api/tracker/events");
    act(() => es.onopen?.());
    expect(result.current.online).toBe(true);

    act(() => es.onerror?.());
    expect(result.current.online).toBe(false);
    expect(es.closed).toBe(true);
    expect(openSources()).toEqual([]);
  });

  // @spec LIVE-API-005
  it("opens the stream again 3 s after it ends, with the same listeners, and goes online when it opens", () => {
    vi.useFakeTimers();
    const onHop = vi.fn();
    const { result } = renderHook(() => useTracker(onHop));
    const first = FakeEventSource.last;
    act(() => first.onopen?.());
    act(() => first.play("status", trackerStatus({ phase: "ground" })));
    act(() => first.onerror?.());

    act(() => vi.advanceTimersByTime(2999));
    expect(FakeEventSource.all).toHaveLength(1);
    act(() => vi.advanceTimersByTime(1));
    expect(FakeEventSource.all).toHaveLength(2);
    const second = FakeEventSource.all[1];
    expect(second.url).toBe("/api/tracker/events");
    expect(openSources()).toEqual([second]);
    expect(result.current.online).toBe(false);

    // The server sends its full state again on the new stream.
    act(() => second.onopen?.());
    expect(result.current.online).toBe(true);
    act(() => second.play("status", trackerStatus({ phase: "airborne", sim_mode: "link" })));
    expect(result.current.status).toMatchObject({ phase: "airborne" });
    act(() => second.play("path", [[pt(41, -71, 100)]]));
    act(() => second.play("path-point", pt(41.01, -71, 105)));
    expect(result.current.path).toEqual([[pt(41, -71, 100), pt(41.01, -71, 105)]]);
    const logged = hop({ id: 9 });
    act(() => second.play("hop", { hop: logged, message: "Logged KBOS → KPVD" }));
    expect(onHop).toHaveBeenCalledWith(logged);
  });

  // @spec LIVE-API-005
  it("opens it again 3 s after each end, one source open at a time", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTracker(() => {}));
    for (let n = 1; n <= 3; n++) {
      const es = FakeEventSource.all[n - 1];
      act(() => es.onopen?.());
      expect(result.current.online).toBe(true);
      act(() => es.onerror?.());
      expect(result.current.online).toBe(false);
      expect(openSources()).toEqual([]);
      act(() => vi.advanceTimersByTime(2999));
      expect(FakeEventSource.all).toHaveLength(n);
      act(() => vi.advanceTimersByTime(1));
      expect(FakeEventSource.all).toHaveLength(n + 1);
      expect(openSources()).toEqual([FakeEventSource.all[n]]);
    }
  });

  // @spec LIVE-API-005
  it("opens no new stream once unmounted while waiting to open it again, and closes the open one on unmount", () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useTracker(() => {}));
    act(() => FakeEventSource.last.onerror?.());
    act(() => vi.advanceTimersByTime(3000));
    expect(FakeEventSource.all).toHaveLength(2);

    // The second stream ends too; the page goes away during the wait.
    act(() => FakeEventSource.all[1].onerror?.());
    unmount();
    act(() => vi.advanceTimersByTime(10_000));
    expect(FakeEventSource.all).toHaveLength(2);
    expect(openSources()).toEqual([]);
  });

  // @spec LIVE-API-005
  it("closes the open stream when unmounted after reopening it", () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useTracker(() => {}));
    act(() => FakeEventSource.last.onerror?.());
    act(() => vi.advanceTimersByTime(3000));
    const second = FakeEventSource.all[1];
    expect(second).toBeDefined();
    expect(second.closed).toBe(false);

    unmount();
    expect(second.closed).toBe(true);
    act(() => vi.advanceTimersByTime(10_000));
    expect(FakeEventSource.all).toHaveLength(2);
  });

  // @spec LIVE-API-005, APP-UI-032
  it("counts each connection once its first status has arrived, so the page knows a reconnect and fresh state", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useTracker(() => {}));
    const first = FakeEventSource.last;
    expect(result.current.connection).toBe(0);
    act(() => first.onopen?.());
    expect(result.current.connection).toBe(0);
    act(() => first.play("status", trackerStatus()));
    expect(result.current.connection).toBe(1);
    act(() => first.play("status", trackerStatus({ phase: "airborne" })));
    expect(result.current.connection).toBe(1);

    act(() => first.onerror?.());
    expect(result.current.connection).toBe(1);
    act(() => vi.advanceTimersByTime(3000));
    const second = FakeEventSource.all[1];
    act(() => second.onopen?.());
    expect(result.current.connection).toBe(1);
    act(() => second.play("status", trackerStatus()));
    expect(result.current.connection).toBe(2);
  });
});
