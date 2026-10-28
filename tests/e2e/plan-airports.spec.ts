import type { Page } from "@playwright/test";
import { E2E_SIMBRIEF_ALIAS } from "../support/e2e-simbrief.ts";
import { expect, test } from "./fixtures.ts";
import { seedTour, settle } from "./seed.ts";

const TITLE = "E2E Plan Aircraft";
const COLOR = "#4361ee";

/** The plan's airport circles in view: their box on screen and the styles that draw them. */
async function circles(page: Page) {
  await settle(page);
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<SVGPathElement>("path.plan-airport"))
      .map((el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return {
          x: r.left + r.width / 2,
          y: r.top + r.height / 2,
          width: r.width,
          stroke: el.getAttribute("stroke"),
          fill: el.getAttribute("fill"),
          fillOpacity: Number(el.getAttribute("fill-opacity")),
          dash: el.getAttribute("stroke-dasharray"),
          animation: s.animationName,
          duration: s.animationDuration,
          pointerEvents: s.pointerEvents,
        };
      })
      .filter((c) => c.x > 0 && c.x < innerWidth && c.y > 0 && c.y < innerHeight),
  );
}

test.describe("the SimBrief plan's airports on the map", () => {
  test.afterEach(async ({ request }) => {
    await request.delete("/api/tracker/briefing");
    await request.put("/api/settings", { data: { simbrief_username: "" } });
  });

  // @spec SB-ROUTE-005, SB-ROUTE-006
  test("are marked with dashed, slowly turning circles in the aircraft's color while the plan is current", async ({ page, request }) => {
    const { aircraft } = await seedTour(request, { color: COLOR });
    const sample = { t: Date.now(), lat: 42.3643, lon: -71.0052, alt_ft: 20, on_ground: true, gs_kts: 0, hdg_deg: 40, title: TITLE, livery: "", atc_id: "N123JB" };
    expect((await request.post("/api/tracker/sample", { data: sample })).ok()).toBe(true);
    expect((await request.post("/api/tracker/bind", { data: { aircraft_id: aircraft.id } })).ok()).toBe(true);

    await page.goto("/?view=42.05,-71.2,9");
    const live = page.locator(".card-live");
    await live.getByPlaceholder("SimBrief alias or pilot ID").fill(E2E_SIMBRIEF_ALIAS);
    await live.getByRole("button", { name: "Save" }).click();
    expect(await circles(page)).toEqual([]);

    await live.getByRole("button", { name: "Import SimBrief plan" }).click();
    await live.getByRole("button", { name: "Use this plan" }).click();
    await expect(live.getByRole("button", { name: "Remove" })).toBeVisible();

    // Both airports, in the aircraft's color, dashed over a faint fill, turning once in about 12 s.
    await expect.poll(async () => (await circles(page)).length).toBe(2);
    const at9 = await circles(page);
    for (const c of at9) {
      expect(c.stroke?.toLowerCase()).toBe(COLOR);
      expect(c.fill?.toLowerCase()).toBe(COLOR);
      expect(c.fillOpacity).toBeGreaterThan(0);
      expect(c.fillOpacity).toBeLessThanOrEqual(0.2);
      expect(c.dash).toBeTruthy();
      expect(c.animation).not.toBe("none");
      expect(c.duration).toBe("12s");
      expect(c.pointerEvents).toBe("none");
      // A 16 px radius, its outline's width aside.
      expect(Math.abs(c.width - 32)).toBeLessThanOrEqual(4);
    }
    // KBOS lies north-east of KPVD.
    const [pvd, bos] = [...at9].sort((a, b) => a.x - b.x);
    expect(bos.y).toBeLessThan(pvd.y);

    // Drawn under the plan's dashed route line.
    const order = await page.evaluate(() => {
      const circle = document.querySelector("path.plan-airport")!;
      const route = Array.from(document.querySelectorAll("path")).find((p) => p.getAttribute("stroke-dasharray") === "6 6")!;
      return circle.compareDocumentPosition(route) & Node.DOCUMENT_POSITION_FOLLOWING;
    });
    expect(order).toBeTruthy();

    // The same size at another zoom.
    await page.goto("/?view=42.05,-71.2,7");
    await expect.poll(async () => (await circles(page)).length).toBe(2);
    for (const c of await circles(page)) expect(Math.abs(c.width - 32)).toBeLessThanOrEqual(4);

    // Still while reduced motion is asked for.
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const c of await circles(page)) expect(c.animation).toBe("none");
    await page.emulateMedia({ reducedMotion: "no-preference" });

    // Gone with the plan.
    await live.getByRole("button", { name: "Remove" }).click();
    await expect.poll(async () => (await circles(page)).length).toBe(0);
  });
});
