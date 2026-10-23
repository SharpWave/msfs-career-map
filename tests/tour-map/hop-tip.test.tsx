import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HopTip } from "../../src/client/components/MapView.tsx";
import type { RenderHop } from "../../src/client/paths.ts";
import type { Hop } from "../../src/client/types.ts";
import { aircraft, airport, hop, touchdown } from "../support/page-data.ts";

function renderTip(h: Hop) {
  const r: RenderHop = { hop: h, aircraft: aircraft(), from: airport(h.origin), to: airport(h.dest), pts: [], nm: 43, tracked: true, flownNm: 47 };
  return render(<HopTip r={r} />);
}

describe("the hop tooltip", () => {
  // @spec MAP-PATH-003, PANEL-LOOK-004
  it("shows the badge and G of the first touchdown of a bounced final landing", () => {
    const landings = [
      touchdown(0, 300, "solid", { g: 1.3 }),
      touchdown(300, 450, "hard", { g: 1.9 }),
      touchdown(303, 80, "butter", { g: 1.1 }),
    ];
    const { container } = renderTip(hop({ landings: JSON.stringify(landings) }));
    const line = container.querySelector(".landing-badge")?.parentElement as HTMLElement;
    expect(line.textContent).toBe("💥 Hard · 450 fpm · 1.90 G");
  });

  // @spec MAP-PATH-003
  it("shows no landing line for a hop without touchdowns", () => {
    const { container } = renderTip(hop());
    expect(container.querySelector(".landing-badge")).toBeNull();
  });
});
