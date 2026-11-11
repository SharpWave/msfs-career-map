import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";

const CHART = "/VFR_Sectional/MapServer/tile/";
const TOPO = "/World_Topo_Map/MapServer/tile/";
const PLACES = "/Reference/World_Boundaries_and_Places/MapServer/tile/";
const IMAGERY = "/World_Imagery/MapServer/tile/";

/** Every tile the page asks for from here on (the browser blocks them all, APP-RUN-018). */
function tileRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/tile/") || r.url().includes("tile.openstreetmap.org")) urls.push(r.url());
  });
  return urls;
}

const chooseBasemap = async (page: Page, name: string) => {
  const menu = page.getByRole("dialog", { name: "Layers" });
  if (!(await menu.isVisible())) await page.getByRole("button", { name: "Layers" }).click();
  await menu.getByRole("button", { name }).click();
};

test.describe("the basemaps", () => {
  // @spec MAP-VIEW-009
  test("Sectional asks for chart tiles from level 8 inward and only Topo tiles further out", async ({ page }) => {
    // Level 7 over New England: the Topo tiles alone.
    await page.goto("/?view=42.05,-71.2,7");
    await expect(page.locator(".leaflet-container")).toBeVisible();
    await page.waitForTimeout(1500);
    const out = tileRequests(page);
    await chooseBasemap(page, "Sectional");
    await expect.poll(() => out.some((u) => u.includes(`${TOPO}7/`))).toBe(true);
    await page.waitForTimeout(1000);
    expect(out.filter((u) => u.includes(CHART))).toEqual([]);

    // Level 8, the same place, Sectional remembered: the chart's level-8 tiles over Topo's.
    const inward = tileRequests(page);
    await page.goto("/?view=42.05,-71.2,8");
    await expect.poll(() => inward.some((u) => u.includes(`${CHART}8/`))).toBe(true);
    await expect.poll(() => inward.some((u) => u.includes(`${TOPO}8/`))).toBe(true);

    // Level 14: the chart's level-12 tiles, enlarged.
    const close = tileRequests(page);
    await page.goto("/?view=42.05,-71.2,14");
    await expect.poll(() => close.some((u) => u.includes(`${CHART}12/`))).toBe(true);
    await page.waitForTimeout(1000);
    expect(close.filter((u) => u.includes(`${CHART}13/`) || u.includes(`${CHART}14/`))).toEqual([]);
  });

  // @spec MAP-VIEW-001
  test("Topo and Hybrid ask for their own tiles", async ({ page }) => {
    await page.goto("/?view=42.05,-71.2,7");
    await expect(page.locator(".leaflet-container")).toBeVisible();
    const urls = tileRequests(page);
    await chooseBasemap(page, "Topo");
    await expect.poll(() => urls.some((u) => u.includes(TOPO))).toBe(true);
    await chooseBasemap(page, "Hybrid");
    await expect.poll(() => urls.some((u) => u.includes(IMAGERY))).toBe(true);
    await expect.poll(() => urls.some((u) => u.includes(PLACES))).toBe(true);
    // Plain Satellite stays plain.
    const plain = tileRequests(page);
    await chooseBasemap(page, "Satellite");
    await expect.poll(() => plain.some((u) => u.includes(IMAGERY))).toBe(true);
    await page.waitForTimeout(1000);
    expect(plain.filter((u) => u.includes(PLACES))).toEqual([]);
  });

  // @spec MAP-VIEW-008
  test("the map credits the FAA and Esri for Sectional, and Esri alone for Topo and Hybrid", async ({ page }) => {
    await page.goto("/");
    const credit = page.locator(".leaflet-control-attribution");
    await chooseBasemap(page, "Sectional");
    await expect(credit).toContainText("FAA Aeronautical Information Services");
    await expect(credit).toContainText("Esri");
    for (const name of ["Topo", "Hybrid"]) {
      await chooseBasemap(page, name);
      await expect(credit).toContainText("Esri");
      await expect(credit).not.toContainText("FAA");
    }
  });

  // @spec MAP-VIEW-002
  test("a chosen basemap is remembered, and one this version does not offer gives Dark", async ({ page }) => {
    await page.goto("/");
    await chooseBasemap(page, "Hybrid");
    await expect(page.locator(".app")).toHaveAttribute("data-basemap", "hybrid");
    await page.reload();
    await expect(page.locator(".app")).toHaveAttribute("data-basemap", "hybrid");
    await page.getByRole("button", { name: "Layers" }).click();
    await expect(page.getByRole("dialog", { name: "Layers" }).getByRole("button", { name: "Hybrid" })).toHaveAttribute("aria-pressed", "true");

    await page.evaluate(() => localStorage.setItem("basemap", "terrain"));
    await page.reload();
    await expect(page.locator(".app")).toHaveAttribute("data-basemap", "dark");
  });
});
