import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Briefing } from "../../src/client/types.ts";
import { aircraft, appState, hop, liveState } from "../support/page-data.ts";

vi.mock("../../src/client/components/ProfileChart.tsx", () => ({ ProfileChart: () => <div>profile chart</div> }));

const { FlightPanel } = await import("../../src/client/components/FlightPanel.tsx");

function plan(over: Partial<Briefing> = {}): Briefing {
  return {
    id: 7, ofp_id: "1760000000_ABC", static_id: null, generated_at: "2026-10-12T13:00:00.000Z", airline: null, flight_number: null,
    callsign: "N6229P", aircraft: { icao: "PA24", name: "Comanche", reg: "N6229P" },
    origin: { icao: "KBOS", name: "Boston", rwy: "04R" }, dest: { icao: "KPVD", name: "Providence", rwy: "05" }, alternate: null,
    route: "DCT", distance_nm: 41, cruise_alt_ft: 5000, ete_min: 22,
    fuel: { units: "lbs", ramp: null, takeoff: null, landing: null, burn: null },
    weights: { pax: 2, cargo: null, payload: null, zfw: null, tow: null, ldw: null }, pdf_url: null, fixes: [],
    hop_id: 5, aircraft_id: 1, plan_html: "<pre>FUEL</pre>", fetched_at: "2026-10-12T13:01:00.000Z",
    ...over,
  };
}

function renderCard(briefing: Briefing) {
  const state = appState({ aircraft: [aircraft()], hops: [hop({ id: 5, briefing_id: briefing.id })] });
  return render(
    <FlightPanel source={{ kind: "hop", hopId: 5 }} state={state} live={liveState(null)} briefing={briefing} onClose={() => {}} onBriefingChanged={() => {}} />,
  );
}

describe("the SimBrief card's OFP text", () => {
  // @spec SB-CARD-006, SB-CARD-009, SB-CARD-010, SB-CARD-011
  it("shows the plan cleaned, whatever the stored plan holds", () => {
    const { container } = renderCard(
      plan({
        plan_html:
          '<script>window.ofpRan = 1</script><div class="flight-panel" onclick="x()" data-handoff-focus="1"><a href="#hop=9">HOP</a>' +
          '<img src="https://x.example/a.png" onerror="window.ofpRan = 1"><pre style="color: red !important">FUEL</pre>' +
          '<a href="https://www.simbrief.com/x">OUT</a></div>',
      }),
    );
    expect(container.querySelector(".ofp-html")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show OFP" }));
    const box = container.querySelector(".ofp-html") as HTMLElement;
    expect(box.querySelector("script, img, [class], [onclick], [data-handoff-focus]")).toBeNull();
    expect(box.querySelector('a[href^="#"]')).toBeNull();
    expect(box.querySelector("pre")!.style.getPropertyPriority("color")).toBe("");
    const out = box.querySelector("a")!;
    expect([out.getAttribute("href"), out.getAttribute("target"), out.getAttribute("rel")]).toEqual(["https://www.simbrief.com/x", "_blank", "noopener noreferrer"]);
    expect(box.textContent).toBe("HOPFUELOUT");
    expect((window as { ofpRan?: number }).ofpRan).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "Hide OFP" }));
    expect(container.querySelector(".ofp-html")).toBeNull();
  });
});

describe("the SimBrief card's PDF", () => {
  // @spec SB-CARD-007, SB-CARD-009
  it("is offered as a link opening as a new window for an address on another origin", () => {
    renderCard(plan({ pdf_url: " HTTPS://www.simbrief.com/ofp/flightplans/KBOSKPVD_PDF_1.pdf" }));
    const pdf = screen.getByRole("link", { name: "PDF" });
    expect(pdf.className).toBe("button small");
    expect([pdf.getAttribute("href"), pdf.getAttribute("target"), pdf.getAttribute("rel")]).toEqual([
      "https://www.simbrief.com/ofp/flightplans/KBOSKPVD_PDF_1.pdf", "_blank", "noopener noreferrer",
    ]);
  });

  // @spec SB-CARD-007, SB-CARD-009
  it("is not offered for an address that is not on another origin, or not http or https", () => {
    for (const pdf_url of ["/api/hops", "#hop=3", `${window.location.origin}/x.pdf`, "javascript:alert(1)", "data:application/pdf,x", "https://"]) {
      const r = renderCard(plan({ pdf_url }));
      expect(screen.queryByRole("link", { name: "PDF" }), pdf_url).toBeNull();
      r.unmount();
    }
  });
});

describe("the SimBrief card's Flight", () => {
  const card = () => screen.getByRole("heading", { name: "SimBrief" }).parentElement as HTMLElement;
  const flight = () => within(card()).getByText("Flight").nextElementSibling?.textContent;

  // @spec SB-CARD-005
  it("is \"—\" when the plan has no callsign, airline or flight number", () => {
    renderCard(plan({ callsign: null, airline: null, flight_number: null, aircraft: { icao: null, name: null, reg: null } }));
    expect(flight()).toBe("—");
  });

  // @spec SB-CARD-004
  it("is the airline and flight number when there is no callsign", () => {
    renderCard(plan({ callsign: null, airline: "JBU", flight_number: "123", aircraft: { icao: null, name: null, reg: null } }));
    expect(flight()).toBe("JBU123");
  });
});
