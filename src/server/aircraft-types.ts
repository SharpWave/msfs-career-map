import raw from "./aircraft-types.json" with { type: "json" };

/**
 * The performance table (fleet, The Performance Table): for each type in SimBrief's list, the numbers
 * the aircraft form asks for, researched once from accepted sources, each with where it came from. It
 * ships in the program, bundled into the server; aircraft-types-check.ts holds the rules it must meet.
 */

export type Preset = "Piston single" | "Piston twin" | "Turboprop" | "Light jet" | "Airliner" | "Helicopter";

export type NumberField =
  | "cruise_kts"
  | "min_runway_ft"
  | "ceiling_ft"
  | "max_xwind_kts"
  | "cruise_alt_ft"
  | "climb_fpm"
  | "climb_kts"
  | "descent_fpm";

/** The eight numbers, in the aircraft record's order. */
export const NUMBER_FIELDS: NumberField[] = [
  "cruise_kts",
  "min_runway_ft",
  "ceiling_ft",
  "max_xwind_kts",
  "cruise_alt_ft",
  "climb_fpm",
  "climb_kts",
  "descent_fpm",
];

/** The block-time inputs: the only numbers a class preset may give. */
export const BLOCK_TIME_FIELDS: NumberField[] = ["cruise_alt_ft", "climb_fpm", "climb_kts", "descent_fpm"];

export interface Source {
  id: string;
  title: string;
  publisher: string;
  page: string;
  url: string;
  /** An MSFS add-on's manual, which only some values may cite (FLEET-TYPE-019). */
  simManual?: true;
}

export type Provenance<T> =
  | { value: T; kind: "published"; sources: string[]; note?: string }
  | { value: T; kind: "derived"; sources: string[]; calculation: string; note?: string }
  | { value: T; kind: "preset"; note?: string }
  /** Another type's sourced number, for a cruise speed or runway no source gives (FLEET-TYPE-020). */
  | { value: T; kind: "estimated"; from: string; note: string };

export interface TypeEntry {
  type: string;
  name: string;
  variant: string;
  preset: Preset;
  /** A built-in icon key (src/client/icon-keys.ts). */
  icon: string;
  /** `YYYY-MM-DD`. */
  researched: string;
  checked: string;
  sources: Source[];
  pressurised: Provenance<boolean> | null;
  /** Every key present; null is blank. */
  values: Record<NumberField, Provenance<number> | null>;
}

export interface Table {
  /** The SimBrief type list the table was built from. */
  snapshot: { date: string; types: string[] };
  omitted: { type: string; reason: string }[];
  entries: TypeEntry[];
}

export const TABLE = raw as unknown as Table;

export interface TypeList {
  snapshot: string;
  types: { type: string; name: string; variant: string }[];
}

/** The table's types, ordered by designator; types left out are not listed. */
// @spec FLEET-TYPE-010
export function typeList(table: Table): TypeList {
  return {
    snapshot: table.snapshot.date,
    types: table.entries
      .map((e) => ({ type: e.type, name: e.name, variant: e.variant }))
      .sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0)),
  };
}

/** One entry by its designator upper-cased and trimmed; null for one the table does not hold. */
// @spec FLEET-TYPE-011
export function typeEntry(table: Table, designator: string): TypeEntry | null {
  const type = designator.trim().toUpperCase();
  if (!/^[A-Z0-9]{2,6}$/.test(type)) return null;
  return table.entries.find((e) => e.type === type) ?? null;
}
