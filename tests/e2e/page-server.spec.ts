/**
 * The page against the browser-test server in a real browser: a hop named in the address
 * (APP-UI-032, APP-UI-034), **Back up now** (APP-UI-037), the page's version matching the server's
 * (APP-API-005), and a window smaller than 800 × 600 (APP-UI-041).
 */
import { expect, test } from "./fixtures.ts";
import { chooseFromMenu, openHopFromFleet, seedTour, settle } from "./seed.ts";

test.describe("the page and its server", () => {
  // @spec APP-UI-032, APP-UI-034, PANEL-OPEN-009
  test("opens the hop a #hop= address names, then clears the fragment", async ({ page, request }) => {
    const { hop } = await seedTour(request);
    await page.goto(`/#hop=${hop.id}`);
    await expect(page.locator(".flight-panel .route")).toHaveText("KBOS → KPVD");
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe("");
  });

  // @spec APP-UI-035
  test("says so for a hop that does not exist", async ({ page }) => {
    await page.goto("/#hop=987654");
    await expect(page.locator(".toast")).toHaveText("That hop no longer exists");
    await expect(page.locator(".flight-panel")).toHaveCount(0);
  });

  // @spec APP-UI-037, APP-BAK-002
  test("backs up from the menu and says where", async ({ page }) => {
    await page.goto("/");
    await chooseFromMenu(page, "Back up now");
    await expect(page.locator(".toast")).toHaveText(/^Backed up to career-\d{8}T\d{6}Z-manual-[0-9a-f]{16}\.db$/);
  });

  // @spec APP-API-005, APP-UI-036
  test("is built with the server's version, so it neither reloads nor shows a version notice", async ({ page }) => {
    let loads = 0;
    page.on("load", () => loads++);
    await page.goto("/");
    await expect(page.locator(".map-layer .leaflet-container")).toBeVisible();
    await page.waitForTimeout(500);
    expect(loads).toBe(1);
    await expect(page.getByText(/This page is version/)).toHaveCount(0);
  });
});

for (const [W, H] of [
  [700, 520],
  [480, 360],
] as const) {
  test.describe(`a small window, ${W} × ${H} (APP-UI-041)`, () => {
    const insideWindow = async (page: import("@playwright/test").Page, selector: string) => {
      await settle(page);
      const b = await page.locator(selector).first().boundingBox();
      expect(b, selector).not.toBeNull();
      expect(Math.round(b!.x), selector).toBeGreaterThanOrEqual(0);
      expect(Math.round(b!.y), selector).toBeGreaterThanOrEqual(0);
      expect(Math.round(b!.x + b!.width), selector).toBeLessThanOrEqual(W);
      expect(Math.round(b!.y + b!.height), selector).toBeLessThanOrEqual(H);
    };

    // @spec APP-UI-041
    test("lays out nothing beyond the window, scrolling the sidebar, drawers and flight panel inside", async ({ page, request }) => {
      const { aircraft } = await seedTour(request);
      await page.setViewportSize({ width: W, height: H });
      await page.goto("/");
      await expect(page.locator(".sidebar")).toBeVisible();
      const overflow = () => page.evaluate(() => ({ x: document.documentElement.scrollWidth, y: document.documentElement.scrollHeight }));
      expect(await overflow()).toEqual({ x: W, y: H });
      await insideWindow(page, ".sidebar");
      await insideWindow(page, ".top-bar");
      // The planner's last control is reachable by scrolling inside the sidebar.
      await page.getByRole("button", { name: "Find airports in range" }).scrollIntoViewIfNeeded();
      await insideWindow(page, ".card-plan button:has-text('Find airports in range')");

      await openHopFromFleet(page, aircraft.id);
      await insideWindow(page, ".drawer:not([hidden])");
      await insideWindow(page, ".flight-panel");
      expect(await overflow()).toEqual({ x: W, y: H });
      // Every card of the flight panel can be scrolled to.
      await page.locator(".flight-panel .fp-card").last().scrollIntoViewIfNeeded();
      await insideWindow(page, ".flight-panel .fp-card >> nth=-1");
      // The drawer's close button and the panel's are within reach, scrolled to.
      for (const sel of [".drawer:not([hidden]) .drawer-head button[aria-label='Close']", ".flight-panel button[aria-label='Close the flight panel']"]) {
        await page.locator(sel).scrollIntoViewIfNeeded();
        await insideWindow(page, sel);
      }
    });
  });
}
