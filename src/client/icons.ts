import type { Aircraft } from "./types";

/**
 * Built-in top-down aircraft silhouettes (nose up, 100x100 viewBox, fill = currentColor).
 * Used when an aircraft has no custom image.
 */
export const BUILTIN_ICONS: Record<string, { label: string; svg: string }> = {
  "single-piston": {
    label: "Single piston (low wing)",
    svg: `<rect x="37" y="1" width="26" height="3" rx="1.5"/>
      <path d="M50 3 C55 3 57 9 57 16 L57 38 L94 46 L94 54 L57 54 L55 78 L70 84 L70 90 L52 88 L50 95 L48 88 L30 90 L30 84 L45 78 L43 54 L6 54 L6 46 L43 38 L43 16 C43 9 45 3 50 3 Z"/>`,
  },
  "high-wing": {
    label: "Single piston (high wing)",
    svg: `<rect x="37" y="1" width="26" height="3" rx="1.5"/>
      <path d="M50 3 C55 3 57 9 57 16 L57 80 L50 95 L43 80 L43 16 C43 9 45 3 50 3 Z"/>
      <rect x="3" y="30" width="94" height="14" rx="4"/>
      <path d="M30 78 L70 78 L70 88 L30 88 Z"/>`,
  },
  "twin-piston": {
    label: "Twin piston",
    svg: `<path d="M50 3 C55 3 57 9 57 16 L57 80 L50 95 L43 80 L43 16 C43 9 45 3 50 3 Z"/>
      <path d="M6 44 L43 40 L57 40 L94 44 L94 52 L57 54 L43 54 L6 52 Z"/>
      <rect x="22" y="26" width="12" height="32" rx="5"/><rect x="66" y="26" width="12" height="32" rx="5"/>
      <rect x="17" y="24" width="22" height="3" rx="1.5"/><rect x="61" y="24" width="22" height="3" rx="1.5"/>
      <path d="M28 80 L43 78 L57 78 L72 80 L72 88 L28 88 Z"/>`,
  },
  turboprop: {
    label: "Twin turboprop",
    svg: `<path d="M50 3 C55 3 57 9 57 16 L57 80 L50 95 L43 80 L43 16 C43 9 45 3 50 3 Z"/>
      <path d="M2 44 L43 40 L57 40 L98 44 L98 52 L57 54 L43 54 L2 52 Z"/>
      <rect x="21" y="18" width="13" height="42" rx="6"/><rect x="66" y="18" width="13" height="42" rx="6"/>
      <rect x="14" y="16" width="27" height="3" rx="1.5"/><rect x="59" y="16" width="27" height="3" rx="1.5"/>
      <path d="M24 86 L76 86 L76 92 L24 92 Z"/>`,
  },
  jet: {
    label: "Business jet",
    svg: `<path d="M50 2 C56 2 58 10 58 18 L58 82 L50 96 L42 82 L42 18 C42 10 44 2 50 2 Z"/>
      <path d="M8 62 L42 40 L58 40 L92 62 L92 69 L58 56 L42 56 L8 69 Z"/>
      <rect x="29" y="64" width="10" height="20" rx="4"/><rect x="61" y="64" width="10" height="20" rx="4"/>
      <path d="M26 86 L74 86 L74 92 L26 92 Z"/>`,
  },
  airliner: {
    label: "Airliner",
    svg: `<path d="M50 2 C56 2 58 10 58 18 L58 84 L50 97 L42 84 L42 18 C42 10 44 2 50 2 Z"/>
      <path d="M3 68 L42 38 L58 38 L97 68 L97 76 L58 58 L42 58 L3 76 Z"/>
      <rect x="21" y="48" width="11" height="22" rx="4"/><rect x="68" y="48" width="11" height="22" rx="4"/>
      <path d="M26 80 L42 76 L58 76 L74 80 L74 90 L58 88 L42 88 L26 90 Z"/>`,
  },
  helicopter: {
    label: "Helicopter",
    svg: `<circle cx="50" cy="38" r="36" fill="none" stroke="currentColor" stroke-width="2" opacity="0.5"/>
      <path d="M50 4 L52 36 L84 44 L52 40 L46 72 L48 40 L16 32 L48 36 Z" opacity="0.85"/>
      <ellipse cx="50" cy="38" rx="12" ry="20"/>
      <rect x="47" y="56" width="6" height="34" rx="2"/>
      <rect x="40" y="88" width="20" height="3" rx="1.5"/>`,
  },
  glider: {
    label: "Glider / motorglider",
    svg: `<path d="M50 6 C53 6 54 10 54 16 L54 84 L50 96 L46 84 L46 16 C46 10 47 6 50 6 Z"/>
      <path d="M1 40 L46 38 L54 38 L99 40 L99 46 L54 47 L46 47 L1 46 Z"/>
      <path d="M34 84 L66 84 L66 89 L34 89 Z"/>`,
  },
};

export const BUILTIN_KEYS = Object.keys(BUILTIN_ICONS);

export function builtinSvg(key: string, extraAttrs = ""): string {
  const icon = BUILTIN_ICONS[key] ?? BUILTIN_ICONS["twin-piston"];
  return `<svg viewBox="0 0 100 100" fill="currentColor" ${extraAttrs}>${icon.svg}</svg>`;
}

/** Inner HTML for an aircraft badge: inline SVG for built-ins, <img> for custom images. */
export function iconInnerHtml(a: Pick<Aircraft, "icon" | "name">): string {
  if (a.icon.startsWith("builtin:")) return builtinSvg(a.icon.slice("builtin:".length));
  const src = a.icon.replace(/"/g, "&quot;");
  const alt = a.name.replace(/"/g, "&quot;");
  return `<img src="${src}" alt="${alt}" />`;
}

/** Full HTML for the map "head" marker showing where an aircraft currently sits. */
export function headMarkerHtml(a: Aircraft, selected: boolean): string {
  return `<div class="plane-head${selected ? " selected" : ""}" style="--c:${a.color}">${iconInnerHtml(a)}</div>`;
}

export const PALETTE = [
  "#ff6b35", "#ffd23f", "#3bceac", "#4cc9f0", "#f72585", "#b5179e",
  "#7209b7", "#4361ee", "#0ead69", "#fb5607", "#ff9f1c", "#2ec4b6",
  "#e71d36", "#8338ec", "#80ed99", "#f9c74f",
];

export function nextColor(used: string[]): string {
  const lower = used.map((c) => c.toLowerCase());
  return PALETTE.find((c) => !lower.includes(c)) ?? PALETTE[used.length % PALETTE.length];
}
