/**
 * The aircraft panel in a real browser: opened from the map, where it sits beside the other panels,
 * its row opening a flight, the hop it marks on the map, and hiding the other aircraft through the
 * server. Each test makes its own aircraft out of Cape Cod, away from the other tests' tours, and
 * removes them.
 */
import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { box, chooseFromMenu, settle } from "./seed.ts";

let n = 0;
const seeded: number[] = [];

test.afterEach(async ({ request }) => {
  for (const id of seeded.splice(0)) await request.delete(`/api/aircraft/${id}`);
  await request.put("/api/aircraft/visibility", { data: { visible: true } });
});

/** An aircraft of the test's own, in a color of its own, with the hops given. */
async function seedAircraft(request: APIRequestContext, color: string, legs: [string, string][]) {
  const name = `E2E panel ${Date.now().toString(36)}-${++n}`;
  const a = await request.post("/api/aircraft", { data: { name, livery: "E2E", color, cruise_kts: 150 } });
  expect(a.ok()).toBe(true);
  const aircraft = (await a.json()) as { id: number; name: string };
  seeded.push(aircraft.id);
  const hops: number[] = [];
  for (const [origin, dest] of legs) {
    const h = await request.post("/api/hops", { data: { aircraft_id: aircraft.id, origin, dest } });
    expect(h.ok()).toBe(true);
    hops.push(((await h.json()) as { id: number }).id);
  }
  return { aircraft, hops };
}

const panel = (page: Page) => page.locator(".aircraft-panel");
const onMap = (page: Page, selector: string) => page.locator(`.leaflet-container ${selector}`);
/** Open an aircraft's panel from its card in the Fleet drawer, then put the sidebar back. */
async function openFromFleet(page: Page, aircraftId: number) {
  await chooseFromMenu(page, "Fleet");
  await page.locator(`#aircraft-${aircraftId} .title-btn`).click();
  await expect(panel(page)).toBeVisible();
  await page.locator(".drawer:not([hidden])").getByRole("button", { name: "Close" }).click();
}

test.describe("the aircraft panel", () => {
  // @spec ACP-OPEN-001, MAP-PARK-002, ACP-LAY-001, ACP-LAY-004, APP-UI-021
  test("opens from a parked aircraft's marker at the right edge, as wide as the left column, the attribution left of it", async ({ page, request }) => {
    const { aircraft } = await seedAircraft(request, "#12ab34", [["KHYA", "KMVY"]]);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    const map = await box(page, ".leaflet-container");
    await onMap(page, '.head-wrap .plane-head[style*="#12ab34"]').first().click();

    await expect(panel(page)).toBeVisible();
    await expect(panel(page).locator(".acp-head .name")).toHaveText(aircraft.name);
    const p = await box(page, ".aircraft-panel");
    expect(p).toMatchObject({ left: 868, right: 1268, top: 64, width: 400 });
    expect(p.bottom).toBeLessThanOrEqual(708);
    // The map keeps the whole window; only the attribution makes way.
    expect(await box(page, ".leaflet-container")).toEqual(map);
    expect((await box(page, ".leaflet-control-attribution")).right).toBeLessThanOrEqual(p.left);

    await page.setViewportSize({ width: 900, height: 700 });
    expect(await box(page, ".aircraft-panel")).toMatchObject({ right: 888, width: 340 });
  });

  // @spec LIVE-LAYER-005, ACP-OPEN-001, ACP-OPEN-002
  test("opens from the live aircraft sitting over its own parked marker, and a second click clears the highlight", async ({ page, request }) => {
    const title = `E2E Panel Live ${Date.now().toString(36)}`;
    const a = await request.post("/api/aircraft", { data: { name: title, livery: "E2E", color: "#12ab34", cruise_kts: 150, sim_title: title, sim_livery: "" } });
    const aircraft = (await a.json()) as { id: number };
    seeded.push(aircraft.id);
    expect((await request.post("/api/hops", { data: { aircraft_id: aircraft.id, origin: "KHYA", dest: "KMVY" } })).ok()).toBe(true);
    // The sim's aircraft, at the gate at Martha's Vineyard where the fleet aircraft is parked.
    const mvy = (await (await request.get("/api/airports/KMVY")).json()) as { lat: number; lon: number };
    const sample = { t: Date.now(), lat: mvy.lat, lon: mvy.lon, alt_ft: 60, on_ground: true, gs_kts: 0, hdg_deg: 240, title, livery: "", atc_id: "N0PNL" };
    expect((await request.post("/api/tracker/sample", { data: sample })).ok()).toBe(true);

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    const live = onMap(page, ".live-wrap").first();
    await expect(live).toBeVisible();
    await page.waitForTimeout(1500);
    await live.click();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).locator(".acp-head .name")).toHaveText(title);

    await page.waitForTimeout(1200);
    await onMap(page, ".live-wrap").first().click();
    await expect(panel(page)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Clear highlight" })).toHaveCount(0);
  });

  // @spec ACP-OPEN-001, MAP-PATH-004, ACP-LAY-001, ACP-LAY-004, ACP-LIST-005
  test("opens with the flight panel from a hop's path, above it, the flight panel keeping its place", async ({ page, request }) => {
    const { hops } = await seedAircraft(request, "#12ab34", [["KHYA", "KMVY"]]);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await expect(onMap(page, `.hop-path.hop-${hops[0]}`).first()).toBeVisible();
    // The first fit flies for 0.6 s; the path is measured once the map is at rest.
    await page.waitForTimeout(1500);
    await settle(page);
    const path = await onMap(page, `.hop-path.hop-${hops[0]}`).first().boundingBox();
    if (!path) throw new Error("the seeded hop is not on the map");
    await page.mouse.click(path.x + path.width / 2, path.y + path.height / 2);

    await expect(panel(page)).toBeVisible();
    await expect(page.locator(".flight-panel")).toBeVisible();
    const flight = await box(page, ".flight-panel");
    expect(flight).toMatchObject({ left: 424, right: 1268, bottom: 708, height: 288 });
    const p = await box(page, ".aircraft-panel");
    expect(p).toMatchObject({ right: 1268, top: 64 });
    expect(p.bottom).toBeLessThanOrEqual(flight.top - 12);
    await expect(panel(page).locator('.acp-row[aria-current="true"]')).toHaveCount(1);
  });

  // @spec ACP-LAY-001, APP-UI-041
  test("stays inside a small window, and runs over the flight panel when too little room is left above it", async ({ page, request }) => {
    const { aircraft } = await seedAircraft(request, "#12ab34", [
      ["KHYA", "KMVY"],
      ["KMVY", "KACK"],
    ]);
    await page.setViewportSize({ width: 700, height: 520 });
    await page.goto("/");
    await openFromFleet(page, aircraft.id);
    await panel(page).locator(".acp-row").first().click();
    await expect(page.locator(".flight-panel")).toBeVisible();
    const flight = await box(page, ".flight-panel");
    const p = await box(page, ".aircraft-panel");
    // 520 px leaves 172 px above the 260 px flight panel: the panel takes the window's height instead.
    expect(p).toMatchObject({ right: 688, top: 64, width: 340 });
    expect(p.bottom).toBeLessThanOrEqual(508);
    expect(p.bottom).toBeGreaterThan(flight.top);
    expect(p.left).toBeGreaterThanOrEqual(0);
    // Everything under its header scrolls as one, so every control can be reached.
    await expect(panel(page)).toHaveClass(/scroll-all/);
    await panel(page).getByRole("button", { name: "Zoom to tour" }).scrollIntoViewIfNeeded();
    await expect(panel(page).getByRole("button", { name: "Zoom to tour" })).toBeInViewport();
  });

  // @spec ACP-LIST-004, ACP-LIST-007, MAP-HL-004, MAP-PATH-005
  test("marks the hop whose row is pointed at on the map, and opens it from the row", async ({ page, request }) => {
    const { aircraft, hops } = await seedAircraft(request, "#12ab34", [
      ["KHYA", "KMVY"],
      ["KMVY", "KACK"],
    ]);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await openFromFleet(page, aircraft.id);
    await expect(panel(page).locator(".acp-list > li")).toHaveCount(2);
    await expect(onMap(page, ".hop-mark")).toHaveCount(0);

    // The latest hop is on top.
    const latest = panel(page).locator(".acp-row").first();
    await expect(latest.locator(".route")).toHaveText("KMVY → KACK");
    await latest.hover();
    await expect(onMap(page, `.hop-mark.hop-mark-${hops[1]}`).first()).toBeVisible();
    // Drawn above every path and under the airport dots (the chevrons and markers are in panes above).
    const order = await page.evaluate(() => {
      const marks = Array.from(document.querySelectorAll(".leaflet-container .hop-mark"));
      const paths = Array.from(document.querySelectorAll(".leaflet-container .hop-path"));
      const dots = Array.from(document.querySelectorAll(".leaflet-container .airport-dot"));
      const follows = (a: Element, b: Element) => (b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
      return {
        marks: marks.length > 0,
        abovePaths: marks.every((m) => paths.every((p) => follows(m, p))),
        underDots: marks.every((m) => dots.every((dot) => follows(dot, m))),
        clickThrough: marks.every((m) => getComputedStyle(m).pointerEvents === "none"),
      };
    });
    expect(order).toEqual({ marks: true, abovePaths: true, underDots: true, clickThrough: true });
    await panel(page).locator(".acp-head .name").hover();
    await expect(onMap(page, ".hop-mark")).toHaveCount(0);

    await latest.click();
    await expect(page.locator(".flight-panel .route")).toHaveText("KMVY → KACK");
    await expect(panel(page)).toBeVisible();
  });

  // @spec ACP-VIS-002, FLEET-LOOK-012, FLEET-LOOK-013, MAP-HL-005
  test("hides the other aircraft until Show all planes, across a reload of the page", async ({ page, request }) => {
    const mine = await seedAircraft(request, "#12ab34", [["KHYA", "KMVY"]]);
    const other = await seedAircraft(request, "#ab12cd", [["KMVY", "KACK"]]);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await expect(onMap(page, `.hop-path.hop-${other.hops[0]}`).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Show all planes" })).toHaveCount(0);

    await openFromFleet(page, mine.aircraft.id);
    await panel(page).getByRole("button", { name: "Hide other planes" }).click();
    await expect(panel(page).getByRole("button", { name: "Hide other planes" })).toHaveAttribute("aria-pressed", "true");
    await expect(onMap(page, `.hop-path.hop-${other.hops[0]}`)).toHaveCount(0);
    await expect(onMap(page, `.hop-path.hop-${mine.hops[0]}`).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Show all planes" })).toBeVisible();

    await page.reload();
    await expect(onMap(page, `.hop-path.hop-${mine.hops[0]}`).first()).toBeVisible();
    await expect(onMap(page, `.hop-path.hop-${other.hops[0]}`)).toHaveCount(0);

    await page.getByRole("button", { name: "Show all planes" }).click();
    await expect(onMap(page, `.hop-path.hop-${other.hops[0]}`).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Show all planes" })).toHaveCount(0);
  });

  // @spec ACP-VIS-001, MAP-HL-005, ACP-VIS-005
  test("hiding its own aircraft takes its tour off the map, leaves the others at full strength and keeps the panel open", async ({ page, request }) => {
    const mine = await seedAircraft(request, "#12ab34", [["KHYA", "KMVY"]]);
    const other = await seedAircraft(request, "#ab12cd", [["KMVY", "KACK"]]);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await openFromFleet(page, mine.aircraft.id);
    const otherPath = onMap(page, `.hop-path.hop-${other.hops[0]}`).first();
    // Highlighted and drawn: the other aircraft is faded.
    await expect(otherPath).toHaveAttribute("stroke-opacity", "0.45");

    await panel(page).getByRole("button", { name: "Hide this plane" }).click();
    await expect(onMap(page, `.hop-path.hop-${mine.hops[0]}`)).toHaveCount(0);
    await expect(otherPath).toHaveAttribute("stroke-opacity", "0.95");
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).locator(".acp-hidden")).toHaveText("hidden from the map");
    await expect(page.getByRole("button", { name: "Clear highlight" })).toBeVisible();
  });
});
