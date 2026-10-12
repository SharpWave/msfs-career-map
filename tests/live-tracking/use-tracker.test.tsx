import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTracker } from "../../src/client/tracker.ts";

/** Stands in for the browser's EventSource so the test can play the server's events. */
class FakeEventSource {
  static last: FakeEventSource;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, ((e: MessageEvent<string>) => void)[]>();
  constructor(public url: string) {
    FakeEventSource.last = this;
  }
  addEventListener(name: string, fn: (e: MessageEvent<string>) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]);
  }
  close() {}
  play(name: string, data: unknown) {
    for (const fn of this.listeners.get(name) ?? []) fn(new MessageEvent(name, { data: JSON.stringify(data) }));
  }
}

const pt = (lat: number, lon: number, s: number) => [lat, lon, 1500, s, 100, 0, 100, 300];

describe("the page's tracker stream", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", FakeEventSource);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
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
});
