/**
 * Which highlight fades the rest of the map (src/client/paths.ts): the highlighted aircraft's, while
 * that aircraft is drawn.
 */
import { describe, expect, it } from "vitest";
import { fadingId } from "../../src/client/paths.ts";
import { aircraft } from "../support/page-data.ts";

const shown = aircraft({ id: 1 });
const hidden = aircraft({ id: 2, name: "TBM 850", visible: 0 });

describe("the highlight's fade", () => {
  // @spec MAP-HL-001
  it("is the highlighted aircraft's while that aircraft is drawn on the map", () => {
    expect(fadingId(1, [shown, hidden])).toBe(1);
  });

  // @spec MAP-HL-005
  it("fades nothing while the highlighted aircraft is hidden from the map", () => {
    expect(fadingId(2, [shown, hidden])).toBeNull();
  });

  // @spec MAP-HL-001
  it("fades nothing without a highlight, or for an aircraft no longer in the fleet", () => {
    expect(fadingId(null, [shown, hidden])).toBeNull();
    expect(fadingId(9, [shown, hidden])).toBeNull();
  });
});
