/**
 * The aircraft form's Airline field (src/client/components/AircraftForm.tsx): beside the SimBrief type,
 * upper-cased as typed, refused unless blank or three letters, and sent as null when blank
 * (FLEET-SIM-005). The server is answered through the fetch guard.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Aircraft } from "../../src/client/types.ts";
import { answerFetch } from "../support/fetch-guard.ts";
import { aircraft } from "../support/page-data.ts";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The form, with the type lists answered and every save recorded. */
async function renderForm(initial?: Aircraft) {
  answerFetch("/api/simbrief/aircraft", () => json({ types: [], source: "fallback", fetched_at: null }));
  answerFetch("/api/aircraft-types", () => json({ snapshot: "2026-10-25", types: [] }));
  const saves: Record<string, unknown>[] = [];
  answerFetch(/\/api\/aircraft(\/\d+)?$/, async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    saves.push(body);
    return json({ ...aircraft(), id: initial?.id ?? 9, ...body }, initial ? 200 : 201);
  });
  vi.resetModules();
  const { AircraftForm } = await import("../../src/client/components/AircraftForm.tsx");
  const onSaved = vi.fn(async () => {});
  const { unmount } = render(<AircraftForm initial={initial} usedColors={[]} onSaved={onSaved} onCancel={() => {}} />);
  return { saves, onSaved, unmount };
}

const airlineField = () => screen.getByLabelText(/^Airline/) as HTMLInputElement;
const save = () => fireEvent.click(screen.getByRole("button", { name: /^(Add aircraft|Save)/ }));

describe("the aircraft form's Airline field", () => {
  // @spec FLEET-SIM-005
  it("sits beside the SimBrief type and upper-cases what is typed", async () => {
    await renderForm();
    const sbType = screen.getByLabelText(/SimBrief aircraft type/);
    const field = airlineField();
    expect(field.closest("label")!.parentElement).toBe(sbType.closest("label")!.parentElement);
    fireEvent.change(field, { target: { value: "jbu" } });
    expect(field.value).toBe("JBU");
  });

  // @spec FLEET-SIM-005
  it("saves three letters as the airline, and a blank one as null", async () => {
    const { saves } = await renderForm();
    fireEvent.change(screen.getByLabelText(/^Aircraft$/), { target: { value: "JetBlue A320" } });
    fireEvent.change(airlineField(), { target: { value: "jbu" } });
    save();
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].airline).toBe("JBU");
  });

  // @spec FLEET-SIM-005
  it("sends a blank airline as null, clearing one the aircraft had", async () => {
    const { saves } = await renderForm(aircraft({ id: 4, airline: "BAW" }));
    expect(airlineField().value).toBe("BAW");
    fireEvent.change(airlineField(), { target: { value: "  " } });
    save();
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0].airline).toBeNull();
  });

  // @spec FLEET-SIM-005
  it("refuses anything else before saving, saying why", async () => {
    for (const bad of ["JB", "JB1", "JETB"]) {
      const { saves, unmount } = await renderForm();
      fireEvent.change(screen.getByLabelText(/^Aircraft$/), { target: { value: "Test" } });
      fireEvent.change(airlineField(), { target: { value: bad } });
      save();
      expect(await screen.findByText("Airline must be a three-letter ICAO airline code")).toBeTruthy();
      expect(saves, bad).toHaveLength(0);
      unmount();
    }
  });
});
