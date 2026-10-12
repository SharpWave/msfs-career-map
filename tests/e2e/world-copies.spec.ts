import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { settle } from "./seed.ts";

// The fixture lists carry Anchorage, Nome and Anadyr, either side of the 180° meridian.
const PANC = { lat: 61.1744, lon: -149.996002 };
const PAOM = { lat: 64.512199, lon: -165.445007 };
const UHMA = { lat: 64.735001, lon: 177.740997 };

/** A world copy at zoom 2 is 1024 px wide. */
const WORLD_AT_2 = 1024;

let n = 0;
const seeded: number[] = [];

// Each test removes its aircraft, so no badge or dot of one test covers what the next one clicks.
test.afterEach(async ({ request }) => {
  for (const id of seeded.splice(0)) await request.delete(`/api/aircraft/${id}`);
});

/** An aircraft of the test's own with one hop, parked at its destination. */
async function seedHop(request: APIRequestContext, origin: string, dest: string, over: Record<string, unknown> = {}) {
  const name = `E2E copies ${Date.now().toString(36)}-${++n}`;
  const a = await request.post("/api/aircraft", { data: { name, livery: "E2E", color: "#f72585", cruise_kts: 150, ...over } });
  expect(a.ok()).toBe(true);
  const aircraft = (await a.json()) as { id: number };
  seeded.push(aircraft.id);
  const h = await request.post("/api/hops", { data: { aircraft_id: aircraft.id, origin, dest } });
  expect(h.ok()).toBe(true);
  const hop = (await h.json()) as { id: number };
  return { aircraft, hop };
}

interface Spot {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The centres of every element matching the selector that is on screen, left to right. */
async function onScreen(page: Page, selector: string): Promise<Spot[]> {
  await settle(page);
  return page.evaluate((sel) => {
    const out: { x: number; y: number; width: number; height: number }[] = [];
    for (const el of Array.from(document.querySelectorAll(sel))) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight) {
        out.push({ x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height });
      }
    }
    return out.sort((a, b) => a.x - b.x);
  }, selector);
}

/** How far the map pane has been moved; it moves exactly as the map is dragged or panned. */
const paneX = (page: Page) =>
  page.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector(".leaflet-map-pane")!).transform).m41);

/** Drag the map, letting the pointer rest before letting go so the map does not coast on. */
async function drag(page: Page, from: { x: number; y: number }, dx: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y, { steps: 20 });
  await page.waitForTimeout(200);
  await page.mouse.up();
  await page.waitForTimeout(300);
}

/** Mercator northing, for placing a point between two known ones on screen. */
const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));

/** Open the page at zoom 2 with the Bering Strait on two world copies, both in the clear part of the map. */
async function twoCopiesOfBering(page: Page, query = "") {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(`/?view=64,14,2${query}`);
  await page.waitForTimeout(1500);
}

test.describe("the map on every world copy", () => {
  // @spec MAP-GEO-014, MAP-GEO-016
  test("two copies of a region in view show the same paths, airport dots and parked aircraft", async ({ page, request }) => {
    const { hop } = await seedHop(request, "PANC", "UHMA");
    await twoCopiesOfBering(page);

    const paths = await onScreen(page, `path.hop-${hop.id}`);
    expect(paths).toHaveLength(2);
    expect(paths[1].x - paths[0].x).toBeCloseTo(WORLD_AT_2, -1);
    // Each copy is the short hop across the strait, not a line across the world.
    for (const p of paths) expect(p.width).toBeLessThan(150);

    for (const ident of ["PANC", "UHMA"]) {
      const dots = await onScreen(page, `path.ap-${ident}`);
      expect(dots).toHaveLength(2);
      expect(dots[1].x - dots[0].x).toBeCloseTo(WORLD_AT_2, -1);
    }

    const uhma = await onScreen(page, "path.ap-UHMA");
    const heads = await onScreen(page, ".head-wrap");
    const near = (dot: Spot) => heads.filter((h) => Math.hypot(h.x - dot.x, h.y - dot.y) < 60).length;
    expect(near(uhma[0])).toBeGreaterThan(0);
    expect(near(uhma[1])).toBe(near(uhma[0]));
  });

  // @spec MAP-VIEW-004
  test("dragging the map carries on across the antimeridian without jumping back to the first world", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto("/?view=64,-178,3");
    await page.waitForTimeout(1500);
    const before = await paneX(page);
    // 700 px at zoom 3 is about 123°: the view moves west from −178°, well past −180°.
    await drag(page, { x: 500, y: 900 }, 700);
    expect((await paneX(page)) - before).toBeCloseTo(700, 0);
  });

  // @spec MAP-GEO-019, MAP-DOT-003
  test("an airport popup opens on the copy clicked and stays open while that copy stays in view", async ({ page, request }) => {
    await seedHop(request, "PANC", "UHMA");
    await twoCopiesOfBering(page);
    // Anchorage on the eastern copy, at 210°.
    const dots = await onScreen(page, "path.ap-PANC");
    expect(dots).toHaveLength(2);
    const east = dots[1];
    const before = await paneX(page);
    await page.mouse.click(east.x, east.y);
    await expect(page.locator(".leaflet-popup")).toBeVisible();
    await page.waitForTimeout(800);
    await expect(page.locator(".leaflet-popup")).toContainText("PANC");
    const moved = (await paneX(page)) - before;
    const tip = (await onScreen(page, ".leaflet-popup-tip"))[0];
    expect(Math.abs(tip.x - (east.x + moved))).toBeLessThan(12);

    await drag(page, { x: 900, y: 900 }, 150);
    await expect(page.locator(".leaflet-popup")).toBeVisible();
    await expect(page.locator(".leaflet-popup")).toContainText("PANC");
  });

  // @spec MAP-GEO-013, PLAN-DRAW-005
  test("planning from Anchorage shows Anadyr west of the ring, and its popup opens where it was clicked", async ({ page, request }) => {
    const { aircraft } = await seedHop(request, "PAOM", "PANC", { cruise_kts: 450 });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(`/?plan=${aircraft.id}&minutes=240`);
    await expect(page.locator(".leaflet-overlay-pane canvas")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1500);

    // Place Anadyr across the meridian, west of Anchorage, from the Anchorage and Nome dots on screen.
    const [panc] = await onScreen(page, "path.ap-PANC");
    const [paom] = await onScreen(page, "path.ap-PAOM");
    const sx = (paom.x - panc.x) / (PAOM.lon - PANC.lon);
    const sy = (paom.y - panc.y) / (merc(PAOM.lat) - merc(PANC.lat));
    const target = { x: panc.x + (UHMA.lon - 360 - PANC.lon) * sx, y: panc.y + (merc(UHMA.lat) - merc(PANC.lat)) * sy };
    expect(target.x).toBeLessThan(paom.x);

    const before = await paneX(page);
    await page.mouse.click(target.x, target.y);
    const popup = page.locator(".leaflet-popup");
    await expect(popup).toBeVisible();
    await expect(popup).toContainText("UHMA");
    await page.waitForTimeout(800);
    const moved = (await paneX(page)) - before;
    // The popup opened beside the dot clicked, not on another world copy.
    expect(Math.abs(moved)).toBeLessThan(600);
    const tip = (await onScreen(page, ".leaflet-popup-tip"))[0];
    expect(Math.abs(tip.x - (target.x + moved))).toBeLessThan(15);
  });

  // @spec MAP-HAZ-010, MAP-HAZ-008
  test("a hazard area straddling the antimeridian is drawn whole on every copy in view, and counted once", async ({ page }) => {
    await page.route("**/api/hazards", (route) =>
      route.fulfill({
        json: {
          fetched_at: new Date().toISOString(),
          errors: [],
          hazards: [
            {
              id: "e2e-strait", source: "isigmet", kind: "CONVECTIVE", label: "CONVECTIVE", severity: null,
              base_ft: null, top_ft: 35000, valid_from: null, valid_to: null, forecast_hour: null,
              coords: [[66, 175], [66, -175], [62, -175], [62, 175]], fir: "PAZA", raw: null,
            },
          ],
        },
      }),
    );
    await twoCopiesOfBering(page, "&wx=1");
    const areas = await onScreen(page, "path.hazard-area");
    expect(areas).toHaveLength(2);
    expect(areas[1].x - areas[0].x).toBeCloseTo(WORLD_AT_2, -1);
    // Ten degrees wide at zoom 2 is under 30 px; an area split across the map would be the map's width.
    for (const a of areas) expect(a.width).toBeLessThan(40);
    await expect(page.locator(".top-bar")).toContainText("1 areas");
  });

  // @spec LIVE-LAYER-002
  test("the live aircraft is drawn on every copy in view", async ({ page, request }) => {
    // South of the Bering Strait, clear of the airports the other tests click.
    const res = await request.post("/api/tracker/sample", {
      data: { t: Date.now(), lat: 52, lon: 179.5, alt_ft: 30, on_ground: true, gs_kts: 0, hdg_deg: 90, title: "E2E Copies Aircraft", livery: "", atc_id: "N0CPY" },
    });
    expect(res.ok()).toBe(true);
    await twoCopiesOfBering(page);
    await expect(page.locator(".live-wrap").first()).toBeAttached();
    const live = await onScreen(page, ".live-wrap");
    expect(live).toHaveLength(2);
    expect(live[1].x - live[0].x).toBeCloseTo(WORLD_AT_2, -1);
  });
});
