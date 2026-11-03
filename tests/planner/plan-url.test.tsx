/**
 * A planner search named in the page address (PLAN-RUN-004): with forecast winds, or in still air
 * for `wind=0`, which the browser tests use.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LiveState } from "../../src/client/tracker.ts";
import { answerFetch } from "../support/fetch-guard.ts";
import { statusBody } from "../support/page-server.ts";
import { aircraft, airport, appState, hop, liveState, planResult } from "../support/page-data.ts";

const stub = vi.hoisted(() => ({ live: null as unknown as LiveState }));
vi.mock("../../src/client/components/MapView.tsx", () => ({ MapView: () => <div data-testid="map" /> }));
vi.mock("../../src/client/tracker.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/tracker.ts")>()),
  useTracker: () => stub.live,
}));

const { App } = await import("../../src/client/App.tsx");

const STATE = appState({ aircraft: [aircraft({ id: 1 })], hops: [hop({ id: 11, aircraft_id: 1, seq: 1, origin: "KBOS", dest: "KPVD" })] });

function answerPage(plans: URL[]) {
  answerFetch("/api/state", () => Response.json(STATE));
  answerFetch("/api/status", () => Response.json(statusBody()));
  answerFetch("/api/logbook/offer", () => Response.json({ hops: 1, aircraft: 1, offers: [], lastAttempt: null }));
  answerFetch("/api/settings", () => Response.json({ simbrief_username: null }));
  answerFetch("/api/simbrief/aircraft", () => Response.json({ types: [], source: "test", fetched_at: null }));
  answerFetch("/api/aircraft-types", () => Response.json({ snapshot: "2026-10-25", types: [] }));
  answerFetch(/\/api\/airports\/[A-Z0-9]+$/, (url) => Response.json(airport(url.pathname.split("/").pop()!)));
  answerFetch(/\/api\/metars\?/, () => Response.json({ metars: {}, fetched_at: "2026-10-09T14:00:00.000Z" }));
  answerFetch(/\/api\/plan\?/, (url) => {
    plans.push(url);
    return Response.json(planResult(1, ["KACK"]));
  });
}

afterEach(() => window.history.replaceState(null, "", "/"));

describe("a search named in the page address", () => {
  // @spec PLAN-RUN-004
  it("runs with forecast winds, or in still air for wind=0", async () => {
    stub.live = liveState();
    const plans: URL[] = [];
    answerPage(plans);
    window.history.replaceState(null, "", "/?plan=1&minutes=60");
    const first = render(<App />);
    await screen.findByRole("heading", { name: "Plan next hop" });
    await waitFor(() => expect(plans).toHaveLength(1));
    expect(plans[0].searchParams.get("max_minutes")).toBe("60");
    expect(plans[0].searchParams.get("wind")).not.toBe("0");
    first.unmount();

    window.history.replaceState(null, "", "/?plan=1&minutes=60&wind=0");
    render(<App />);
    await waitFor(() => expect(plans).toHaveLength(2));
    expect(plans[1].searchParams.get("wind")).toBe("0");
  });
});
