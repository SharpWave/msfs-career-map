import type { Airport, Hop, SurfaceClass } from "./types";

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function fmtTimeShort(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function fmtDuration(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min)) return "";
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m.toString().padStart(2, "0")}m` : `${m}m`;
}

export function fmtFt(ft: number): string {
  return `${Math.round(ft).toLocaleString()} ft`;
}

export function fmtNm(nm: number): string {
  return `${Math.round(nm).toLocaleString()} nm`;
}

/** Logged duration, or the difference between departure and arrival if both are known. */
export function hopDurationMin(h: Hop): number | null {
  if (h.duration_min != null) return h.duration_min;
  if (h.departed_at && h.arrived_at) {
    const ms = new Date(h.arrived_at).getTime() - new Date(h.departed_at).getTime();
    if (Number.isFinite(ms) && ms >= 0) return Math.round(ms / 60000);
  }
  return null;
}

/** ISO timestamp -> value for an <input type="datetime-local"> (local time). */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** datetime-local value -> ISO timestamp, or null when blank. */
export function localInputToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function aircraftLabel(a: { name: string; livery: string }): string {
  return a.livery ? `${a.name} · ${a.livery}` : a.name;
}

const TYPE_LABELS: Record<string, string> = {
  large_airport: "Large airport",
  medium_airport: "Medium airport",
  small_airport: "Small airport",
  seaplane_base: "Seaplane base",
  heliport: "Heliport",
  balloonport: "Balloonport",
};

export function airportTypeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type.replace(/_/g, " ");
}

const SURFACE_LABELS: Record<SurfaceClass, string> = {
  paved: "paved",
  grass: "grass",
  gravel: "gravel",
  dirt: "dirt",
  water: "water",
  snow: "snow/ice",
  unknown: "surface unknown",
};

export function surfaceLabel(s: SurfaceClass | string): string {
  return SURFACE_LABELS[s as SurfaceClass] ?? s;
}

/** One-line runway summary: "10,083 ft · paved · 6 rwys" or "" when nothing is known. */
export function runwaySummary(a: Airport): string {
  if (!a.rwy_count) return "";
  const parts: string[] = [];
  if (a.rwy_max_ft != null) parts.push(fmtFt(a.rwy_max_ft));
  if (a.rwy_surfaces) parts.push(a.rwy_surfaces.split(",").map(surfaceLabel).join("/"));
  parts.push(`${a.rwy_count} rwy${a.rwy_count === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

/** Airport location line: "Warwick, RI, US". */
export function airportWhere(a: Airport): string {
  return [a.municipality, a.iso_region?.replace(/^.*-/, ""), a.iso_country].filter(Boolean).join(", ");
}
