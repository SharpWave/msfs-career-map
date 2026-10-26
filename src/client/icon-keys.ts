/**
 * The built-in icons' keys, in the order the aircraft form offers them. icons.ts draws each one; the
 * performance table names one per type (FLEET-TYPE-001), checked against this list. No imports, so the
 * server's checks can read it too.
 */
export const BUILTIN_KEYS = ["single-piston", "high-wing", "twin-piston", "turboprop", "jet", "airliner", "helicopter", "glider"] as const;

export type BuiltinKey = (typeof BUILTIN_KEYS)[number];
