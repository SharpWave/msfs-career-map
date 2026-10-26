/**
 * Typical block-time numbers by class; climb speed is a fraction of cruise. The aircraft form's class
 * chips fill them (FLEET-PERF-003), and the performance table's preset values must be these figures
 * (FLEET-TYPE-006). No imports, so the server's checks can read it too.
 */
export const PERF_PRESETS = [
  { label: "Piston single", alt: 6500, climb: 700, climbFrac: 0.65, descent: 500, overhead: 12 },
  { label: "Piston twin", alt: 8000, climb: 1000, climbFrac: 0.7, descent: 700, overhead: 12 },
  { label: "Turboprop", alt: 24000, climb: 1500, climbFrac: 0.6, descent: 1500, overhead: 15 },
  { label: "Light jet", alt: 37000, climb: 2500, climbFrac: 0.6, descent: 2000, overhead: 15 },
  { label: "Airliner", alt: 35000, climb: 2000, climbFrac: 0.6, descent: 2000, overhead: 20 },
  { label: "Helicopter", alt: 2000, climb: 800, climbFrac: 0.8, descent: 500, overhead: 8 },
] as const;

export type PerfPreset = (typeof PERF_PRESETS)[number];

export function presetByLabel(label: string): PerfPreset | undefined {
  return PERF_PRESETS.find((p) => p.label === label);
}
