/**
 * The page's layout and look in a real browser: sizes, what covers the map, glass, type, focus and
 * motion. Each test makes its own aircraft and asserts nothing about what others left behind.
 */
import { expect, test } from "./fixtures.ts";
import { box, chooseFromMenu, openHopFromFleet, seedTour } from "./seed.ts";

const ACCENT = "rgb(255, 107, 53)";
const DANGER = "rgb(255, 92, 92)";

/** Alpha of a computed background color, 1 for an opaque one. */
const alphaOf = (color: string) => {
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return NaN;
  const parts = m[1].split(/[ ,/]+/).filter(Boolean);
  return parts.length > 3 ? Number(parts[3]) : 1;
};
const style = (page: import("@playwright/test").Page, selector: string, prop: string, pseudo?: string) =>
  page.locator(selector).first().evaluate((el, [p, ps]) => getComputedStyle(el, ps ?? null).getPropertyValue(p as string), [prop, pseudo] as const);

test.describe("layout", () => {
  // @spec APP-UI-009
  test("the sidebar and drawers are 400 px wide under the top bar, 340 px in a narrow window", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    expect(await box(page, ".sidebar")).toMatchObject({ left: 12, top: 64, width: 400, bottom: 708 });
    await chooseFromMenu(page, "Fleet");
    const drawer = await box(page, ".drawer:not([hidden])");
    expect(drawer).toMatchObject({ left: 12, top: 64, width: 400 });
    expect(drawer.bottom).toBeLessThanOrEqual(708);
    await page.setViewportSize({ width: 900, height: 700 });
    expect((await box(page, ".drawer:not([hidden])")).width).toBe(340);
  });

  // @spec APP-UI-009, PANEL-OPEN-008
  test("the flight panel spans from the left column to the window's edge, 40% of the window high", async ({ page, request }) => {
    const { aircraft } = await seedTour(request);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await openHopFromFleet(page, aircraft.id);
    expect(await box(page, ".flight-panel")).toMatchObject({ left: 424, right: 1268, bottom: 708, height: 288 });
    expect((await style(page, ".fp-body", "grid-template-columns")).trim().split(/\s+/)).toHaveLength(2);

    await page.getByRole("button", { name: "Hide sidebar" }).click();
    expect(await box(page, ".flight-panel")).toMatchObject({ left: 12, right: 1268 });

    await page.getByRole("button", { name: "Show sidebar" }).click();
    await page.setViewportSize({ width: 1100, height: 600 });
    expect(await box(page, ".flight-panel")).toMatchObject({ left: 424, height: 260 });
    expect((await style(page, ".fp-body", "grid-template-columns")).trim().split(/\s+/)).toHaveLength(1);
  });

  // @spec APP-UI-010
  test("the planner card scrolls inside itself, list included, below a live card of at most half the sidebar", async ({ page }) => {
    await page.goto("/");
    expect(await style(page, ".card-plan .card-body", "overflow-y")).toBe("auto");
    // No plan has run, so try a candidate list in the planner card for its style.
    const listMax = await page.locator(".card-plan .card-body").evaluate((body) => {
      const ol = document.createElement("ol");
      ol.className = "cand-list";
      body.appendChild(ol);
      const v = getComputedStyle(ol).maxHeight;
      ol.remove();
      return v;
    });
    expect(listMax).toBe("none");
    const sidebarHeight = (await box(page, ".sidebar")).height;
    const liveMax = parseFloat(await style(page, ".card-live", "max-height"));
    expect(Math.abs(liveMax - sidebarHeight / 2)).toBeLessThanOrEqual(1);
  });

  // @spec APP-UI-011
  test("clicks between the sidebar's cards reach the map", async ({ page }) => {
    await page.goto("/");
    const live = await box(page, ".card-live");
    const plan = await box(page, ".card-plan");
    const x = live.left + 40;
    const y = Math.round((live.bottom + plan.top) / 2);
    expect(plan.top - live.bottom).toBeGreaterThanOrEqual(8);
    const insideMap = await page.evaluate(([px, py]) => !!document.elementFromPoint(px, py)?.closest(".leaflet-container"), [x, y]);
    expect(insideMap).toBe(true);
  });

  // @spec MAP-VIEW-005
  test("panels opening and closing over the map never move it, and the map fills the window", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1500);
    const pane = () => style(page, ".leaflet-map-pane", "transform");
    const before = await pane();
    await chooseFromMenu(page, "Fleet");
    await page.getByRole("button", { name: "Hide sidebar" }).click();
    await page.getByRole("button", { name: "Show sidebar" }).click();
    expect(await pane()).toBe(before);
    await page.setViewportSize({ width: 1000, height: 640 });
    expect(await box(page, ".leaflet-container")).toMatchObject({ left: 0, top: 0, width: 1000, height: 640 });
  });
});

test.describe("the covered part of the map", () => {
  // @spec APP-UI-020, MAP-ZOOM-007
  test("a hop opened from the Fleet drawer is fitted into the part the panels leave clear", async ({ page, request }) => {
    const { aircraft, hop } = await seedTour(request);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto("/");
    await openHopFromFleet(page, aircraft.id);
    await page.waitForTimeout(1500);
    const path = await box(page, `path.hop-${hop.id}`);
    const panel = await box(page, ".flight-panel");
    expect(path.left).toBeGreaterThanOrEqual(412);
    expect(path.top).toBeGreaterThanOrEqual(52);
    expect(path.bottom).toBeLessThanOrEqual(panel.top);
  });

  // @spec APP-UI-021
  test("an airport popup opens inside the clear part, and the attribution sits above the flight panel", async ({ page, request }) => {
    const { aircraft } = await seedTour(request);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto("/");
    await openHopFromFleet(page, aircraft.id);
    await page.waitForTimeout(1500);
    const panel = await box(page, ".flight-panel");
    expect((await box(page, ".leaflet-control-attribution")).bottom).toBeLessThanOrEqual(panel.top);

    // KBOS, where no test aircraft is parked (their badges sit on KPVD's dot), on the world copy in view.
    const dot = await page.evaluate(() => {
      for (const el of Array.from(document.querySelectorAll("path.ap-KBOS"))) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight) {
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
      }
      return null;
    });
    expect(dot).not.toBeNull();
    await page.mouse.click(dot!.x, dot!.y);
    await expect(page.locator(".leaflet-popup")).toBeVisible();
    await page.waitForTimeout(1000);
    const popup = await box(page, ".leaflet-popup");
    expect(popup.left).toBeGreaterThanOrEqual(412);
    expect(popup.top).toBeGreaterThanOrEqual(52);
    expect(popup.bottom).toBeLessThanOrEqual(panel.top);
  });

  // @spec APP-UI-022
  test("the menu sits above the left column", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Career Map" }).click();
    const menu = await box(page, "[role=menu]");
    const sidebar = await box(page, ".sidebar");
    expect(menu.bottom).toBeGreaterThan(sidebar.top);
    const y = Math.round((Math.max(menu.top, sidebar.top) + menu.bottom) / 2);
    const onMenu = await page.evaluate(([x, py]) => !!document.elementFromPoint(x, py)?.closest("[role=menu]"), [menu.left + 20, y]);
    expect(onMenu).toBe(true);
  });
});

test.describe("the look", () => {
  // @spec APP-UI-023
  test("panels are frosted glass, blurred at most 12 px, with a heavier tint in drawers and over the Light basemap", async ({ page }) => {
    await page.goto("/");
    const blur = await style(page, ".card-plan", "backdrop-filter");
    const px = Number(blur.match(/blur\(([\d.]+)px\)/)?.[1]);
    expect(px).toBeGreaterThan(0);
    expect(px).toBeLessThanOrEqual(12);
    const card = alphaOf(await style(page, ".card-plan", "background-color"));
    expect(card).toBeLessThan(1);

    await chooseFromMenu(page, "Fleet");
    const drawer = alphaOf(await style(page, ".drawer:not([hidden])", "background-color"));
    expect(drawer).toBeGreaterThan(card);
    await page.getByRole("button", { name: "Close" }).click();

    await page.getByRole("button", { name: "Layers" }).click();
    await page.getByRole("dialog", { name: "Layers" }).getByRole("button", { name: "Light" }).click();
    expect(alphaOf(await style(page, ".card-plan", "background-color"))).toBeGreaterThan(card);
    await page.getByRole("dialog", { name: "Layers" }).getByRole("button", { name: "Dark" }).click();
  });

  // @spec APP-UI-024
  test("panels are opaque and unblurred while reduced transparency is asked for", async ({ page }) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-transparency", value: "reduce" }] });
    await page.goto("/");
    expect(await style(page, ".card-plan", "backdrop-filter")).toBe("none");
    expect(alphaOf(await style(page, ".card-plan", "background-color"))).toBe(1);
  });

  // @spec APP-UI-025
  test("text is set in B612 and codes in B612 Mono, both served by the app", async ({ page }) => {
    const fontRequests: string[] = [];
    page.on("request", (r) => {
      if (r.resourceType() === "font") fontRequests.push(r.url());
    });
    await page.goto("/");
    await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toMatch(/^"?B612"?,/);
    await page.getByRole("button", { name: "Career Map" }).click();
    expect(await page.evaluate(() => document.fonts.check('13px "B612"') && document.fonts.check('13px "B612 Mono"'))).toBe(true);
    const mono = await page.evaluate(() => {
      const el = document.createElement("span");
      el.className = "code";
      document.body.appendChild(el);
      const f = getComputedStyle(el).fontFamily;
      el.remove();
      return f;
    });
    expect(mono).toMatch(/^"?B612 Mono"?,/);
    expect(fontRequests.length).toBeGreaterThan(0);
    for (const url of fontRequests) expect(new URL(url).hostname).toBe("localhost");
  });

  // @spec APP-UI-027
  test("a control reached by keyboard shows an accent focus ring", async ({ page }) => {
    await page.goto("/");
    await page.locator("body").press("Tab");
    const ring = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const s = getComputedStyle(el);
      return { tag: el.tagName, style: s.outlineStyle, color: s.outlineColor };
    });
    expect(ring.tag).toBe("BUTTON");
    expect(ring.style).toBe("solid");
    expect(ring.color).toBe(ACCENT);
  });

  // @spec APP-UI-028
  test("nothing animates while reduced motion is asked for, the live marker's pulse included", async ({ page, request }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await chooseFromMenu(page, "Fleet");
    expect(await style(page, ".drawer:not([hidden])", "animation-name")).toBe("none");
    const res = await request.post("/api/tracker/sample", {
      data: { t: Date.now(), lat: 41.7246, lon: -71.4282, alt_ft: 55, on_ground: true, gs_kts: 0, hdg_deg: 50, title: "E2E Motion Aircraft", livery: "", atc_id: "N0MOT" },
    });
    expect(res.ok()).toBe(true);
    await expect(page.locator(".live-marker")).toBeAttached();
    expect(await style(page, ".live-marker", "animation-name", "::before")).toBe("none");
  });

  // @spec APP-UI-006
  test("the theme's colors are variables, and the accent marks actions, not status", async ({ page }) => {
    await page.goto("/");
    const vars = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return ["--accent", "--text", "--muted", "--ok", "--caution", "--airborne", "--danger"].map((v) => s.getPropertyValue(v).trim());
    });
    expect(vars).toEqual(["#ff6b35", "#e8edf2", "#93a1b3", "#3bceac", "#fbbf24", "#7cc4ff", "#ff5c5c"]);
    expect(await style(page, ".card-live .pill", "color")).not.toBe(ACCENT);
    expect(await style(page, ".card-plan button.primary", "background-color")).toBe(ACCENT);
  });

  // @spec APP-UI-007
  test("hints and warnings under fields share one style, the planner's altitude warning included", async ({ page, request }) => {
    const { aircraft } = await seedTour(request, { oxygen: false });
    await page.goto("/");
    const planner = page.locator(".card-plan");
    await planner.getByLabel("Aircraft").selectOption(String(aircraft.id));
    await planner.getByLabel(/Cruise altitude/).fill("15000");
    const warning = planner.locator(".hint.bad");
    await expect(warning).toHaveText(/without oxygen or pressurisation/);
    expect(await warning.evaluate((el) => getComputedStyle(el).color)).toBe(DANGER);
    const fromHint = planner.locator(".airport-input .hint").first();
    const [a, b] = await Promise.all([warning, fromHint].map((l) => l.evaluate((el) => getComputedStyle(el).fontSize)));
    expect(a).toBe(b);
  });
});
