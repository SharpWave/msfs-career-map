import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { settle } from "./seed.ts";

const TITLE = "E2E Casual Aircraft";
/** A world copy at zoom 2 is 1024 px wide. */
const WORLD_AT_2 = 1024;

/** Feeds the synthetic sim one sample a second from `start`, moving by `step` degrees each second while it has speed. */
function flier(request: APIRequestContext, start: { lat: number; lon: number }, step: { lat: number; lon: number }) {
  let t = Date.now();
  let { lat, lon } = start;
  const sample = async (on_ground: boolean, gs_kts: number) => {
    const res = await request.post("/api/tracker/sample", {
      // The sim reports longitudes within ±180°.
      data: { t, lat, lon: ((lon + 540) % 360) - 180, alt_ft: on_ground ? 20 : 1500, on_ground, gs_kts, hdg_deg: 20, ias_kts: gs_kts, title: TITLE, livery: "", atc_id: "N0CAS" },
    });
    expect(res.ok()).toBe(true);
    t += 1000;
    if (gs_kts >= 1) {
      lat += step.lat;
      lon += step.lon;
    }
  };
  return {
    ground: async (n: number, gs = 0) => { for (let i = 0; i < n; i++) await sample(true, gs); },
    air: async (n: number) => { for (let i = 0; i < n; i++) await sample(false, 120); },
  };
}

/** The centres of the casual path's dashed lines on screen, left to right. */
async function casualLines(page: Page) {
  await settle(page);
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("path.casual-path"))
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight)
      .map((r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 }))
      .sort((a, b) => a.x - b.x),
  );
}

test.describe("casual mode", () => {
  // @spec LIVE-CARD-012, LIVE-CASUAL-001, LIVE-LAYER-004, LIVE-LAYER-003, LIVE-CASUAL-008
  test("a flight with the Casual switch on is drawn dashed behind the aircraft and leaves nothing to log", async ({ page, request }) => {
    const hopsBefore = ((await (await request.get("/api/state")).json()) as { hops: unknown[] }).hops.length;
    // Over the open Atlantic, far from any airport in the fixture lists.
    const start = { lat: 30, lon: -40 };
    await page.goto(`/?view=${start.lat + 0.15},${start.lon + 0.05},9`);

    const live = page.locator(".card-live");
    const sw = live.getByRole("switch", { name: "Casual" });
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "true");

    const f = flier(request, start, { lat: 0.01, lon: 0.003 });
    await f.ground(3, 10);
    await f.air(30);
    await f.ground(5, 40);
    await f.ground(35);

    await expect(live.locator(".pill")).toHaveText("casual");
    const dashed = page.locator("path.casual-path").first();
    await expect(dashed).toBeAttached();
    expect(await dashed.getAttribute("stroke-dasharray")).toBeTruthy();
    expect(await casualLines(page)).toHaveLength(1);

    const st = (await (await request.get("/api/tracker")).json()) as { leg: unknown; pending: unknown; casual: { points: number } };
    expect(st.leg).toBeNull();
    expect(st.pending).toBeNull();
    expect(st.casual.points).toBeGreaterThan(5);
    expect(((await (await request.get("/api/state")).json()) as { hops: unknown[] }).hops).toHaveLength(hopsBefore);

    await page.locator(".live-wrap").first().hover();
    await expect(page.locator(".leaflet-tooltip")).toContainText(`CASUAL · ${TITLE}`);

    await sw.click();
    await expect(sw).toHaveAttribute("aria-checked", "false");
    await expect(page.locator("path.casual-path")).toHaveCount(0);
  });

  // @spec LIVE-LAYER-004
  test("the casual path is drawn on every world copy in view", async ({ page, request }) => {
    const res = await request.put("/api/tracker/casual", { data: { on: true } });
    expect(res.ok()).toBe(true);
    // South of the Bering Strait, crossing the 180° meridian north-eastwards.
    const f = flier(request, { lat: 52, lon: 178.5 }, { lat: 0.1, lon: 0.15 });
    await f.air(20);

    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto("/?view=64,14,2");
    await expect(page.locator("path.casual-path").first()).toBeAttached();
    const lines = await casualLines(page);
    expect(lines).toHaveLength(2);
    expect(lines[1].x - lines[0].x).toBeCloseTo(WORLD_AT_2, -1);
  });
});
