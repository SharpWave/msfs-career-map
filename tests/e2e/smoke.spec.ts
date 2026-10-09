import { expect, test } from "./fixtures.ts";
import { fixtureCounts } from "../support/run-folder.ts";
import { E2E_API_PORT, E2E_PAGE_PORT } from "../support/ports.ts";

const LOCAL = new Set([`localhost:${E2E_API_PORT}`, `localhost:${E2E_PAGE_PORT}`, `127.0.0.1:${E2E_API_PORT}`, `127.0.0.1:${E2E_PAGE_PORT}`]);
const isLocal = (url: string) => url.startsWith("data:") || LOCAL.has(new URL(url).host);

test.describe("browser-test servers", () => {
  // @spec APP-RUN-017
  test("the page reaches the test server, which has the fixture airport lists", async ({ request }) => {
    const res = await request.get("/api/status");
    expect(res.ok()).toBe(true);
    expect(await res.json()).toMatchObject({ ok: true, airports: fixtureCounts().airports, runways: fixtureCounts().runways });
  });

  // @spec APP-RUN-012, APP-UI-001
  test("the page loads on an empty logbook, with the sidebar's cards in order", async ({ page }) => {
    await page.goto("/");
    const head = page.locator(".sidebar-head");
    await expect(head.locator("h1")).toHaveText("Career Map");
    const { airports, runways } = fixtureCounts();
    await expect(head).toContainText(`0 aircraft · 0 hops · ${airports} airports · ${runways} runways`);
    // With no aircraft, the only second-level headings in the sidebar are the cards' titles.
    const titles = page.locator(".sidebar").getByRole("heading", { level: 2 });
    await expect(titles).toHaveText(["Live from the sim", "Log a hop", "Plan next hop", "Fleet"]);
  });

  // @spec APP-RUN-012
  test("the app server takes the synthetic sim feed", async ({ request }) => {
    const res = await request.post("/api/tracker/sample", {
      data: {
        t: Date.now(), lat: 41.7246, lon: -71.4282, alt_ft: 55, on_ground: true, gs_kts: 0, hdg_deg: 50,
        title: "E2E Smoke Aircraft", livery: "", atc_id: "N0E2E",
      },
    });
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ connected: true });
  });

  // @spec APP-RUN-018
  test("the app server refuses outside requests it has no fixture answer for", async ({ request }) => {
    const res = await request.get("/api/hazards");
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as { hazards: unknown[]; errors: string[] };
    expect(body.hazards).toEqual([]);
    expect(body.errors).toHaveLength(3);
    for (const e of body.errors) expect(e).toMatch(/refused/);
  });

  // @spec APP-RUN-018
  test("the browser blocks the page's requests to anything but the test servers", async ({ page }) => {
    const outsideFailed: string[] = [];
    const outsideServed: string[] = [];
    page.on("requestfailed", (r) => {
      if (!isLocal(r.url())) outsideFailed.push(r.url());
    });
    page.on("response", (r) => {
      if (!isLocal(r.url())) outsideServed.push(r.url());
    });
    await page.goto("/");
    // The basemap asks for tiles as soon as the map has a view.
    await expect.poll(() => outsideFailed.length, { timeout: 15_000 }).toBeGreaterThan(0);
    expect(outsideServed).toEqual([]);
  });
});
