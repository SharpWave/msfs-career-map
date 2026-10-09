import { describe, expect, it } from "vitest";
import { answerFetch, takeRefused } from "../support/fetch-guard.ts";

describe("requests from component tests", () => {
  // @spec APP-RUN-014
  it("refuses a page API call the test has not answered, since component tests start no server", async () => {
    await expect(fetch("/api/state")).rejects.toThrow(/refused/);
    expect(takeRefused()).toHaveLength(1);
  });

  // @spec APP-RUN-014
  it("returns the answer the test supplied for a page API call", async () => {
    answerFetch("/api/tracker", () => Response.json({ phase: "idle" }));
    const res = await fetch("/api/tracker");
    expect(await res.json()).toEqual({ phase: "idle" });
    expect(takeRefused()).toEqual([]);
  });

  // @spec APP-RUN-011
  it("runs in a simulated browser and opens no database", () => {
    expect(typeof document).toBe("object");
    expect(process.env.CAREER_DB).toBeUndefined();
  });
});
