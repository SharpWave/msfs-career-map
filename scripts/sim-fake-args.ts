/**
 * The sim-fake tool's command line, apart from the tool so it can be tested: this module starts
 * nothing on import.
 */

export interface SimFakeArgs {
  /** The departure and destination codes: the first two arguments that are neither options nor option values. */
  from: string | null;
  to: string | null;
  /** The server the samples go to, with no trailing `/`. */
  base: string;
  /** Virtual seconds per real second. */
  speed: number;
  cruise: number;
  alt: number;
  title: string;
  livery: string;
  atc: string;
  /** Touchdown descent rate and peak G. */
  fpm: number;
  g: number;
  touchAndGo: boolean;
  startAirborne: boolean;
}

/** Options that take a value, as `--name value` or `--name=value`, and their defaults. */
const VALUE_DEFAULTS = {
  speed: "30",
  cruise: "150",
  alt: "6500",
  title: "Fake Aircraft",
  livery: "",
  atc: null as string | null,
  base: "http://127.0.0.1:3080",
  fpm: "180",
  g: "1.4",
};
type ValueName = keyof typeof VALUE_DEFAULTS;
const isValueName = (n: string): n is ValueName => Object.prototype.hasOwnProperty.call(VALUE_DEFAULTS, n);

/**
 * Reads the tool's arguments. A value option given twice takes the last value; an unknown option
 * takes no value and is otherwise ignored.
 */
// @spec LIVE-TOOL-003, LIVE-TOOL-005
export function parseSimFakeArgs(argv: readonly string[]): SimFakeArgs {
  const values: { [K in ValueName]: string | null } = { ...VALUE_DEFAULTS };
  const flags = new Set<string>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf("=");
    const name = eq >= 0 ? a.slice(2, eq) : a.slice(2);
    if (!isValueName(name)) {
      flags.add(name);
      continue;
    }
    if (eq >= 0) values[name] = a.slice(eq + 1);
    else if (i + 1 < argv.length) values[name] = argv[++i];
  }
  const livery = values.livery ?? "";
  return {
    from: positional[0] ?? null,
    to: positional[1] ?? null,
    base: (values.base ?? VALUE_DEFAULTS.base).replace(/\/$/, ""),
    speed: Number(values.speed),
    cruise: Number(values.cruise),
    alt: Number(values.alt),
    title: values.title ?? VALUE_DEFAULTS.title,
    livery,
    atc: values.atc ?? (livery || "N000FK"),
    fpm: Number(values.fpm),
    g: Number(values.g),
    touchAndGo: flags.has("touch-and-go"),
    startAirborne: flags.has("start-airborne"),
  };
}
