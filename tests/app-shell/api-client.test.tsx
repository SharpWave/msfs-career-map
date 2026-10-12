import { describe, expect, it } from "vitest";
import { api, ApiError } from "../../src/client/api.ts";
import { answerFetch } from "../support/fetch-guard.ts";

describe("the browser's request helper", () => {
  // @spec APP-API-007, APP-API-006
  it("raises an error carrying the status and the answer's body alongside the server's message", async () => {
    const body = { error: "a leg is being flown", aircraft_id: 3, name: "TBM 850", origin: "KPVD", departed_at: "2026-10-12T14:00:00.000Z" };
    answerFetch("/api/tracker", () => Response.json(body, { status: 409 }));
    const err = await api.tracker().then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({ message: "a leg is being flown", status: 409, body });
  });

  // @spec APP-API-007, APP-API-006
  it("carries the status, and the status text as its message, when the answer is not JSON", async () => {
    answerFetch("/api/tracker", () => new Response("<html>bad gateway</html>", { status: 502, statusText: "Bad Gateway" }));
    await expect(api.tracker()).rejects.toMatchObject({ message: "502 Bad Gateway", status: 502 });
  });
});
