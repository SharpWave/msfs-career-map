import { expect, test } from "./fixtures.ts";
import { openHopFromFleet, seedTour, settle } from "./seed.ts";

/** A plan id no test server holds: the page is answered this plan by the test itself. */
const PLAN_ID = 987654;

/** An OFP text that tries every way to act as the page, load something or draw outside its box. */
const HOSTILE_OFP = [
  '<meta http-equiv="refresh" content="0;url=/ofp-load/refresh#hop=1">',
  '<base href="https://ofp-load.example/">',
  '<link rel="stylesheet" href="/ofp-load/sheet.css">',
  '<style>@import "/ofp-load/import.css"; body { display: none }</style>',
  '<script src="/ofp-load/script.js"></script><script>window.ofpRan = 1</script>',
  '<img src="/ofp-load/img.png" onerror="window.ofpRan = 1"><img src="https://ofp-load.example/img.png">',
  '<video poster="/ofp-load/poster.png" src="/ofp-load/video.mp4"></video>',
  '<iframe src="/ofp-load/frame.html"></iframe>',
  '<table background="/ofp-load/table.png"><tr><td background="/ofp-load/cell.png">1</td></tr></table>',
  '<div style="background: url(/ofp-load/style.png)">styled</div>',
  '<div style="background: u\\72l(/ofp-load/escape.png)">escaped</div>',
  '<pre><span title="loud" style="color: rgb(255, 0, 0) !important; font-family: \'Comic Sans MS\' !important; font-size: 40px !important; background: rgb(0, 0, 255) !important">LOUD</span></pre>',
  '<div title="fixed" style="position: fixed; top: 0; left: 0; width: 40px; height: 40px">F</div>',
  '<div title="away" style="position: absolute; top: -400px; left: -400px; width: 40px; height: 40px">A</div>',
  '<a href="https://www.simbrief.com/ofp/x">OUT</a> <a href="/api/hops">HOME</a> <a href="#hop=1">FRAGMENT</a>',
].join("");

test.describe("the SimBrief card's OFP text", () => {
  // @spec SB-CARD-006, SB-CARD-009, SB-CARD-010, SB-CARD-011
  test("shows a plan as text and layout only: nothing runs, loads, navigates or is drawn outside its box", async ({ page, request }) => {
    const { aircraft, hop } = await seedTour(request);
    await page.route("**/api/state", async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as { hops: { id: number; briefing_id: number | null }[] };
      for (const h of body.hops) if (h.id === hop.id) h.briefing_id = PLAN_ID;
      await route.fulfill({ response: res, json: body });
    });
    await page.route(`**/api/briefings/${PLAN_ID}`, (route) =>
      route.fulfill({
        json: {
          id: PLAN_ID, ofp_id: "e2e", static_id: null, generated_at: null, airline: null, flight_number: null, callsign: "E2E1",
          aircraft: { icao: null, name: null, reg: null }, origin: { icao: "KBOS", name: null, rwy: null }, dest: { icao: "KPVD", name: null, rwy: null },
          alternate: null, route: "DCT", distance_nm: null, cruise_alt_ft: null, ete_min: null,
          fuel: { units: "lbs", ramp: null, takeoff: null, landing: null, burn: null },
          weights: { pax: null, cargo: null, payload: null, zfw: null, tow: null, ldw: null },
          pdf_url: "https://www.simbrief.com/ofp/flightplans/E2E.pdf", fixes: [],
          hop_id: hop.id, aircraft_id: aircraft.id, plan_html: HOSTILE_OFP, fetched_at: "2026-10-26T12:00:00.000Z",
        },
      }),
    );
    const loads: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("ofp-load")) loads.push(r.url());
    });

    await page.goto("/");
    await openHopFromFleet(page, aircraft.id);
    const pdf = page.locator(".fp-card").getByRole("link", { name: "PDF" });
    await expect(pdf).toHaveAttribute("href", "https://www.simbrief.com/ofp/flightplans/E2E.pdf");
    await expect(pdf).toHaveAttribute("target", "_blank");
    await expect(pdf).toHaveAttribute("rel", "noopener noreferrer");
    const address = page.url();

    await page.getByRole("button", { name: "Show OFP" }).click();
    const ofp = page.locator(".ofp-html");
    await expect(ofp).toContainText("LOUD");
    await page.waitForTimeout(1500);
    await settle(page);

    expect(loads).toEqual([]);
    expect(await page.evaluate(() => (window as { ofpRan?: number }).ofpRan)).toBeUndefined();
    expect(page.url()).toBe(address);
    await expect(page.locator("body")).toBeVisible();
    expect(await ofp.locator("script, style, link, meta, base, img, video, iframe, [background]").count()).toBe(0);

    const out = ofp.getByRole("link", { name: "OUT" });
    await expect(out).toHaveAttribute("href", "https://www.simbrief.com/ofp/x");
    await expect(out).toHaveAttribute("target", "_blank");
    await expect(out).toHaveAttribute("rel", "noopener noreferrer");
    await expect(ofp.getByRole("link", { name: "HOME" })).toHaveCount(0);
    await expect(ofp.getByRole("link", { name: "FRAGMENT" })).toHaveCount(0);
    await expect(ofp).toContainText("HOME");

    const look = await page.evaluate(() => {
      const box = document.querySelector(".ofp-html") as HTMLElement;
      const loud = box.querySelector('[title="loud"]') as HTMLElement;
      const b = getComputedStyle(box);
      const l = getComputedStyle(loud);
      return {
        box: [b.color, b.fontFamily, b.fontSize],
        loud: [l.color, l.fontFamily, l.fontSize, l.backgroundColor],
        contain: b.contain,
      };
    });
    expect(look.loud).toEqual([...look.box, "rgba(0, 0, 0, 0)"]);
    expect(look.contain).toMatch(/paint|content|strict/);

    const inside = await ofp.boundingBox();
    const fixed = await ofp.locator('[title="fixed"]').boundingBox();
    expect(inside && fixed).toBeTruthy();
    expect(fixed!.x).toBeGreaterThanOrEqual(inside!.x);
    expect(fixed!.y).toBeGreaterThanOrEqual(inside!.y);
    expect(fixed!.x + fixed!.width).toBeLessThanOrEqual(inside!.x + inside!.width);
    expect(fixed!.y + fixed!.height).toBeLessThanOrEqual(inside!.y + inside!.height);
    // Drawn outside the box, the "away" square would cover this point, above and left of the box.
    const away = await ofp.locator('[title="away"]').boundingBox();
    const hit = await page.evaluate(([x, y]) => (document.elementFromPoint(x, y) as HTMLElement | null)?.title ?? null, [away!.x + 20, away!.y + 20]);
    expect(hit).not.toBe("away");
  });
});
