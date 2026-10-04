import type { Aircraft, Airport } from "./types";

/**
 * SimBrief's dispatch page pre-fills from URL parameters (see the "Dispatch Redirect Guide" on
 * the Navigraph forum): orig, dest, type (ICAO designator), reg, plus optional airline/fltnum/etc.
 */
export const SIMBRIEF_DISPATCH = "https://dispatch.simbrief.com/options/custom";

/** Code SimBrief will recognise for an airport: ICAO where known, otherwise the OurAirports ident. */
export function simbriefAirportCode(a: Airport): string {
  return a.icao_code ?? a.ident;
}

/** Livery text that looks like a registration (N6017Y, G-ABCD, D-EABC) is passed as `reg`. */
export function registrationFrom(livery: string): string | null {
  const s = livery.trim().toUpperCase();
  return /^[A-Z0-9]{1,2}-?[A-Z0-9]{2,5}$/.test(s) ? s : null;
}

export interface SimbriefLeg {
  orig: string;
  dest: string;
  type: string | null;
  reg: string | null;
}

export function simbriefUrl(leg: SimbriefLeg): string {
  const p = new URLSearchParams({ orig: leg.orig, dest: leg.dest });
  if (leg.type) p.set("type", leg.type);
  if (leg.reg) p.set("reg", leg.reg);
  return `${SIMBRIEF_DISPATCH}?${p.toString()}`;
}

export function legFor(origin: Airport, dest: Airport, aircraft: Aircraft | undefined): SimbriefLeg {
  return {
    orig: simbriefAirportCode(origin),
    dest: simbriefAirportCode(dest),
    type: aircraft?.simbrief_type ?? null,
    reg: aircraft ? registrationFrom(aircraft.livery) : null,
  };
}

/**
 * Common ICAO type designators for aircraft people fly in MSFS, offered as suggestions in the
 * aircraft form. SimBrief accepts any designator from its own list; this is just a shortcut.
 */
export const COMMON_TYPES: [string, string][] = [
  ["C152", "Cessna 152"],
  ["C172", "Cessna 172 Skyhawk"],
  ["C182", "Cessna 182 Skylane"],
  ["C208", "Cessna 208 Caravan"],
  ["C25C", "Citation CJ4"],
  ["C510", "Citation Mustang"],
  ["C700", "Citation Longitude"],
  ["P28A", "Piper Cherokee / Warrior / Archer"],
  ["PA24", "Piper Comanche"],
  ["PA32", "Piper Saratoga / Lance"],
  ["PA34", "Piper Seneca"],
  ["PA44", "Piper Seminole"],
  ["PA46", "Piper Malibu / Mirage / M350"],
  ["P46T", "Piper Meridian / M500 / M600"],
  ["AEST", "Piper / Ted Smith Aerostar"],
  ["BE33", "Beech Debonair / Bonanza 33"],
  ["BE36", "Beech Bonanza A36 / G36"],
  ["BE58", "Beech Baron 58"],
  ["BE9L", "Beech King Air 90"],
  ["B350", "Beech King Air 350"],
  ["DA40", "Diamond DA40"],
  ["DA42", "Diamond DA42"],
  ["DA62", "Diamond DA62"],
  ["SR22", "Cirrus SR22"],
  ["SF50", "Cirrus Vision Jet"],
  ["TBM7", "TBM 700"],
  ["TBM8", "TBM 850"],
  ["TBM9", "TBM 900 / 930 / 940"],
  ["PC12", "Pilatus PC-12"],
  ["PC6T", "Pilatus PC-6 Porter"],
  ["DHC2", "DHC-2 Beaver"],
  ["DHC6", "DHC-6 Twin Otter"],
  ["J3", "Piper J-3 Cub"],
  ["M20P", "Mooney M20"],
  ["AC50", "Aero Commander 500"],
  ["H25B", "Hawker 800"],
  ["CL30", "Challenger 300"],
  ["A320", "Airbus A320"],
  ["A20N", "Airbus A320neo"],
  ["B738", "Boeing 737-800"],
  ["B38M", "Boeing 737 MAX 8"],
  ["B748", "Boeing 747-8"],
  ["B78X", "Boeing 787-10"],
  ["AT76", "ATR 72-600"],
  ["DH8D", "Dash 8 Q400"],
  ["R44", "Robinson R44"],
  ["H145", "Airbus H145"],
];
