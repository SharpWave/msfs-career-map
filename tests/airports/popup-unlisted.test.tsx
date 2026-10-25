/**
 * The airport popup for an airport kept after the lists dropped it (APT-DATA-009).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AirportPopup } from "../../src/client/components/AirportPopup.tsx";
import type { Airport } from "../../src/client/types.ts";
import { answerFetch } from "../support/fetch-guard.ts";

// The popup closes its map popup on "Use"; nothing here needs a real map.
vi.mock("react-leaflet", () => ({ useMap: () => ({ closePopup: () => {} }) }));

const airport = (unlisted: number): Airport =>
  ({
    ident: "KPVD",
    type: "large_airport",
    name: "Rhode Island T. F. Green International Airport",
    lat: 41.725,
    lon: -71.426,
    elevation_ft: 55,
    iso_country: "US",
    iso_region: "US-RI",
    municipality: "Providence/Warwick",
    icao_code: "KPVD",
    iata_code: "PVD",
    gps_code: "KPVD",
    local_code: "PVD",
    wikipedia_link: null,
    home_link: null,
    rwy_max_ft: 8700,
    rwy_count: 1,
    rwy_surfaces: "paved",
    rwy_paved: 1,
    rwy_lighted: 1,
    rwy_headings: "50",
    runways: [],
    unlisted,
  }) as Airport;

const noMetar = () => answerFetch("/api/metar/KPVD", () => new Response(JSON.stringify({ error: "no current METAR for KPVD" }), { status: 404 }));

describe("the popup of an airport no longer listed (APT-DATA-009)", () => {
  // @spec APT-DATA-009
  it("states that OurAirports no longer lists it", async () => {
    noMetar();
    render(<AirportPopup airport={airport(1)} />);
    expect(screen.getByText("No longer listed by OurAirports")).toBeTruthy();
    await screen.findByText("No current METAR for KPVD.");
  });

  // @spec APT-DATA-009
  it("says nothing of the kind for a listed airport", async () => {
    noMetar();
    render(<AirportPopup airport={airport(0)} />);
    await screen.findByText("No current METAR for KPVD.");
    expect(screen.queryByText("No longer listed by OurAirports")).toBeNull();
  });
});
