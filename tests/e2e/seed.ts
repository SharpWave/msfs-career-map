import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "./fixtures.ts";

let n = 0;

/** An aircraft of the test's own, under a name no other test uses, with one hop KBOS → KPVD. */
export async function seedTour(request: APIRequestContext, over: Record<string, unknown> = {}) {
  const name = `E2E ${Date.now().toString(36)}-${++n}`;
  const a = await request.post("/api/aircraft", { data: { name, livery: "E2E", color: "#4361ee", cruise_kts: 150, ...over } });
  expect(a.ok()).toBe(true);
  const aircraft = (await a.json()) as { id: number; name: string };
  const h = await request.post("/api/hops", { data: { aircraft_id: aircraft.id, origin: "KBOS", dest: "KPVD" } });
  expect(h.ok()).toBe(true);
  const hop = (await h.json()) as { id: number };
  return { aircraft, hop };
}

/** Open the menu and choose one of its entries. */
export async function chooseFromMenu(page: Page, entry: "Log a hop" | "Fleet") {
  await page.getByRole("button", { name: "Career Map" }).click();
  await page.getByRole("menuitem", { name: entry }).click();
}

/** Open a seeded hop from its row in the Fleet drawer, which opens the flight panel and zooms to it. */
export async function openHopFromFleet(page: Page, aircraftId: number) {
  await chooseFromMenu(page, "Fleet");
  const card = page.locator(`#aircraft-${aircraftId}`);
  await card.getByRole("button", { name: "Show 1 hop" }).click();
  await card.locator(".hop-main").first().click();
  await expect(page.locator(".flight-panel")).toBeVisible();
}

/** Let panels finish sliding in (endless animations, like the live marker's pulse, are left running). */
export async function settle(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

/** A box's edges, rounded to whole pixels, once panels have settled. */
export async function box(page: Page, selector: string) {
  await settle(page);
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error(`${selector} has no box`);
  const r = (v: number) => Math.round(v);
  return { left: r(b.x), top: r(b.y), right: r(b.x + b.width), bottom: r(b.y + b.height), width: r(b.width), height: r(b.height) };
}
