import { BUILTIN_KEYS } from "../client/icon-keys.ts";
import { BLOCK_TIME_FIELDS, NUMBER_FIELDS, type NumberField, type Provenance, type Table, type TypeEntry } from "./aircraft-types.ts";

/**
 * The rules the performance table must meet (FLEET-TYPE-001 to 008, 019, 020), as one problem per broken rule, each
 * naming the type and the field or source it is about. The tests run it on the shipped table as it
 * stands; `npm run aircraft-types:check` runs it asking for the table complete, as a release needs it.
 * Pure: no files, no network.
 */

/** Hosts no source may be on, nor any name under them (FLEET-TYPE-004). */
export const FORBIDDEN_HOSTS = [
  // Encyclopedias and wikis.
  "wikipedia.org",
  "wikimedia.org",
  "wikiwand.com",
  "fandom.com",
  // Databases whose terms forbid republishing their figures without permission.
  "skybrary.aero",
  "learningzone.eurocontrol.int",
  "contentzone.eurocontrol.int",
  // Forums, flight-simulation community sites and file libraries, and enthusiast sites.
  "pprune.org",
  "reddit.com",
  "flightsim.to",
  "forums.flightsimulator.com",
  "avsim.com",
  "x-plane.org",
  "airliners.net",
];

const PRESETS = ["Piston single", "Piston twin", "Turboprop", "Light jet", "Airliner", "Helicopter"];
const DESIGNATOR = /^[A-Z0-9]{2,6}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The aircraft record's range for each number (FLEET-REC-005, 007, 009); every number is also > 0. */
const RANGES: Record<NumberField, [number, number]> = {
  cruise_kts: [1, 2000],
  min_runway_ft: [1, 30000],
  ceiling_ft: [1, 100000],
  max_xwind_kts: [1, 100],
  cruise_alt_ft: [500, 60000],
  climb_fpm: [50, 10000],
  climb_kts: [20, 600],
  descent_fpm: [50, 10000],
};

interface PresetFigures {
  label: string;
  alt: number;
  climb: number;
  climbFrac: number;
  descent: number;
}

const blank = (s: unknown) => typeof s !== "string" || s.trim() === "";
const round5 = (n: number) => Math.round(n / 5) * 5;

function forbiddenHost(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
  return FORBIDDEN_HOSTS.find((h) => host === h || host.endsWith(`.${h}`)) ?? null;
}

function httpUrl(url: unknown): boolean {
  if (typeof url !== "string") return false;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** The numbers an estimate may give (FLEET-TYPE-002). */
const ESTIMATED_FIELDS: string[] = ["cruise_kts", "min_runway_ft"];

/** Problems with one value's provenance; `field` names it in each. */
function provenanceProblems(type: string, field: string, p: Provenance<unknown>, presetAllowed: boolean, cited: Set<string>): string[] {
  const out: string[] = [];
  const at = `${type} ${field}`;
  if (p.kind === "published" || p.kind === "derived") {
    if (!Array.isArray(p.sources) || p.sources.length === 0) out.push(`${at}: a ${p.kind} value cites no source`);
    else for (const id of p.sources) cited.add(id);
    if (p.kind === "derived" && blank(p.calculation)) out.push(`${at}: a derived value has no calculation`);
  } else if (p.kind === "preset") {
    if (!presetAllowed) out.push(`${at}: only cruise altitude, climb rate, climb speed and descent rate may be preset`);
  } else if (p.kind === "estimated") {
    if (!ESTIMATED_FIELDS.includes(field)) out.push(`${at}: only cruise speed and minimum runway may be estimated`);
  } else {
    out.push(`${at}: provenance "${String((p as { kind: unknown }).kind)}" is none of published, derived, preset, estimated`);
  }
  return out;
}

/** Problems with an estimated value: its similar type, that type's number and the note (FLEET-TYPE-020). */
function estimateProblems(e: TypeEntry, field: NumberField, p: Provenance<unknown>, byType: Map<string, TypeEntry>): string[] {
  if (p.kind !== "estimated" || !ESTIMATED_FIELDS.includes(field)) return [];
  const at = `${e.type} ${field}`;
  const out: string[] = [];
  if (blank(p.note)) out.push(`${at}: an estimate has no note saying why its similar type was chosen`);
  const similar = p.from === e.type ? undefined : byType.get(p.from);
  if (!similar) return [...out, `${at}: estimated from ${String(p.from)}, which is not another type the table holds`];
  const base = similar.values?.[field];
  if (!base || (base.kind !== "published" && base.kind !== "derived")) {
    out.push(`${at}: estimated from ${similar.type}, whose ${field} is not published or derived`);
  } else if (base.value !== p.value) {
    out.push(`${at}: estimated ${String(p.value)} is not ${similar.type}'s ${field} ${base.value}`);
  }
  return out;
}

/** What the preset makes of `field` in `e`, or null where it gives nothing. */
function presetFigure(e: TypeEntry, field: NumberField, preset: PresetFigures): number | null {
  switch (field) {
    case "climb_fpm":
      return preset.climb;
    case "descent_fpm":
      return preset.descent;
    case "cruise_alt_ft": {
      let alt = preset.alt;
      const ceiling = e.values.ceiling_ft?.value;
      if (typeof ceiling === "number") alt = Math.min(alt, ceiling);
      if (e.pressurised?.value !== true) alt = Math.min(alt, 12000);
      return alt;
    }
    case "climb_kts": {
      const cruise = e.values.cruise_kts?.value;
      return typeof cruise === "number" ? round5(preset.climbFrac * cruise) : null;
    }
    default:
      return null;
  }
}

function entryProblems(e: TypeEntry, presets: readonly PresetFigures[], byType: Map<string, TypeEntry>): string[] {
  const out: string[] = [];
  const t = e.type;
  // What an entry holds (FLEET-TYPE-001).
  if (blank(e.name)) out.push(`${t} name: missing`);
  if (blank(e.variant)) out.push(`${t} variant: missing`);
  if (!PRESETS.includes(e.preset)) out.push(`${t} preset: "${e.preset}" is not one of the six class presets`);
  if (!(BUILTIN_KEYS as readonly string[]).includes(e.icon)) out.push(`${t} icon: "${e.icon}" is not a built-in icon`);
  const values = (e.values ?? {}) as Partial<TypeEntry["values"]>;
  for (const f of NUMBER_FIELDS) if (!(f in values)) out.push(`${t} ${f}: missing (blank is null)`);

  // Provenance (FLEET-TYPE-002), collecting the ids cited.
  const cited = new Set<string>();
  if (e.pressurised) out.push(...provenanceProblems(t, "pressurised", e.pressurised, false, cited));
  for (const f of NUMBER_FIELDS) {
    const p = values[f];
    if (p) out.push(...provenanceProblems(t, f, p, BLOCK_TIME_FIELDS.includes(f), cited), ...estimateProblems(e, f, p, byType));
  }

  // Sources (FLEET-TYPE-003, 004).
  const listed = new Set<string>();
  for (const s of e.sources ?? []) {
    const at = `${t} source ${s.id}`;
    if (listed.has(s.id)) out.push(`${at}: id listed twice`);
    listed.add(s.id);
    for (const k of ["title", "publisher", "page"] as const) if (blank(s[k])) out.push(`${at}: ${k} missing`);
    if (!httpUrl(s.url)) out.push(`${at}: url "${s.url}" is not an http or https address`);
    else {
      const host = forbiddenHost(s.url);
      if (host) out.push(`${at}: url is on ${host}, which no source may be on`);
    }
  }
  for (const id of cited) if (!listed.has(id)) out.push(`${t}: cites source ${id}, which the entry does not list`);
  for (const id of listed) if (!cited.has(id)) out.push(`${t} source ${id}: listed but cited by no value`);

  // An MSFS add-on's manual: the limits, cruise speed and pressurisation, and the cruise altitude
  // only beside a cruise speed citing it (FLEET-TYPE-019).
  const manuals = new Set((e.sources ?? []).filter((s) => s.simManual === true).map((s) => s.id));
  const citesOf = (p: Provenance<unknown> | null | undefined) =>
    p && (p.kind === "published" || p.kind === "derived") && Array.isArray(p.sources) ? p.sources.filter((id) => manuals.has(id)) : [];
  const cruiseManuals = citesOf(values.cruise_kts);
  for (const f of ["climb_fpm", "climb_kts", "descent_fpm"] as const) {
    for (const id of citesOf(values[f])) out.push(`${t} ${f}: cites ${id}, an MSFS add-on's manual, which may not give it`);
  }
  for (const id of citesOf(values.cruise_alt_ft)) {
    if (!cruiseManuals.includes(id)) out.push(`${t} cruise_alt_ft: cites ${id}, an MSFS add-on's manual, which the cruise speed does not cite`);
  }

  // The numbers (FLEET-TYPE-005).
  for (const f of NUMBER_FIELDS) {
    const v = values[f]?.value;
    if (v === undefined) continue;
    const [lo, hi] = RANGES[f];
    if (typeof v !== "number" || !Number.isInteger(v)) out.push(`${t} ${f}: ${String(v)} is not a whole number`);
    else if (v <= 0 || v < lo || v > hi) out.push(`${t} ${f}: ${v} is outside ${lo}–${hi}`);
  }
  const cruise = values.cruise_kts?.value;
  const climbKts = values.climb_kts?.value;
  if (typeof cruise === "number" && typeof climbKts === "number" && climbKts > cruise) {
    out.push(`${t} climb_kts: ${climbKts} is faster than the cruise speed ${cruise}`);
  }
  const ceiling = values.ceiling_ft?.value;
  const alt = values.cruise_alt_ft?.value;
  if (typeof ceiling === "number" && typeof alt === "number" && alt > ceiling) {
    out.push(`${t} cruise_alt_ft: ${alt} is above the service ceiling ${ceiling}`);
  }

  // The class presets' figures (FLEET-TYPE-006).
  const preset = presets.find((p) => p.label === e.preset);
  if (preset) {
    for (const f of BLOCK_TIME_FIELDS) {
      const p = values[f];
      if (p?.kind !== "preset") continue;
      const want = presetFigure(e, f, preset);
      if (want === null) out.push(`${t} ${f}: a preset climb speed needs the entry's cruise speed`);
      else if (p.value !== want) out.push(`${t} ${f}: preset value ${p.value} is not the ${e.preset} preset's ${want}`);
    }
  }

  // The dates and at least one number (FLEET-TYPE-007).
  if (!DATE.test(e.researched ?? "")) out.push(`${t} researched: "${e.researched}" is not YYYY-MM-DD`);
  if (!DATE.test(e.checked ?? "")) out.push(`${t} checked: "${e.checked}" is not YYYY-MM-DD`);
  else if (DATE.test(e.researched ?? "") && e.checked < e.researched) out.push(`${t} checked: ${e.checked} is before the research ${e.researched}`);
  const sourced = (f: NumberField) => values[f]?.kind === "published" || values[f]?.kind === "derived";
  if (!NUMBER_FIELDS.some(sourced)) out.push(`${t}: gives none of the eight numbers as published or derived`);
  return out;
}

/**
 * The table's problems: [] when it meets FLEET-TYPE-001 to 008, 019 and 020. `complete` also asks for every type of
 * the snapshot to be an entry or left out, as a release needs (DESK-DIST-REL-012).
 */
// @spec FLEET-TYPE-001, FLEET-TYPE-002, FLEET-TYPE-003, FLEET-TYPE-004, FLEET-TYPE-005, FLEET-TYPE-006, FLEET-TYPE-007, FLEET-TYPE-008, FLEET-TYPE-019, FLEET-TYPE-020
export function checkTable(table: Table, presets: readonly PresetFigures[], o: { complete: boolean }): string[] {
  const out: string[] = [];
  const snapshot = new Set(table.snapshot?.types ?? []);
  if (!DATE.test(table.snapshot?.date ?? "")) out.push(`snapshot: date "${table.snapshot?.date}" is not YYYY-MM-DD`);
  if (snapshot.size === 0) out.push("snapshot: holds no designators");

  const seen = new Set<string>();
  const byType = new Map(table.entries.map((e) => [e.type, e]));
  const designator = (type: string) => {
    if (!DESIGNATOR.test(type)) out.push(`${type}: not a designator of 2–6 capital letters or digits`);
    if (seen.has(type)) out.push(`${type}: held more than once`);
    seen.add(type);
    if (!snapshot.has(type)) out.push(`${type}: not in the snapshot of SimBrief's list`);
  };
  for (const e of table.entries) {
    designator(e.type);
    out.push(...entryProblems(e, presets, byType));
  }
  for (const left of table.omitted) {
    designator(left.type);
    if (blank(left.reason)) out.push(`${left.type}: left out with no reason`);
  }
  if (o.complete) {
    const missing = [...snapshot].filter((t) => !seen.has(t)).sort();
    if (missing.length > 0) out.push(`snapshot: ${missing.length} types neither in the table nor left out: ${missing.join(", ")}`);
  }
  return out;
}

/** SimBrief's designators the table neither holds nor leaves out, upper-cased and sorted. */
// @spec FLEET-TYPE-018
export function missingTypes(simbriefIds: string[], table: Table): string[] {
  const known = new Set([...table.entries.map((e) => e.type), ...table.omitted.map((o) => o.type)]);
  return [...new Set(simbriefIds.map((id) => id.toUpperCase()))].filter((id) => !known.has(id)).sort();
}
