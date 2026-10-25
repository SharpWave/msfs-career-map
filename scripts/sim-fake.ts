/**
 * Flies a synthetic leg through the tracker so the whole pipeline can be tested without the sim.
 * The server it feeds must be on the fake feed: started with --sim=fake (for example
 * `npm run dev:server -- --sim=fake`), which also leaves the real SimConnect link alone.
 *
 *   npm run sim-fake -- KBOS KPVD
 *   npm run sim-fake -- KBOS KPVD --speed 60 --title "Cessna 172 Skyhawk" --livery "N123AB" --atc N123AB
 *   npm run sim-fake -- --base http://127.0.0.1:<port> KBOS KPVD
 *
 * Options, as `--name value` or `--name=value`: --speed N (virtual seconds per real second,
 * default 30), --cruise KTS (150), --alt FT (6500), --base URL (the server, default
 * http://127.0.0.1:3080), --title, --livery and --atc (the livery, else N000FK), --fpm N
 * (touchdown descent rate, default 180), --g N (peak G at touchdown, default 1.4). Flags:
 * --touch-and-go (bounce once at the destination before the full stop), --start-airborne (begin
 * mid-flight, no departure airport). The two airports can come anywhere among them.
 */
import { parseSimFakeArgs } from "./sim-fake-args.ts";

// @spec LIVE-TOOL-003, LIVE-TOOL-005
const args = parseSimFakeArgs(process.argv.slice(2));
if (!args.from || !args.to) {
  console.error("usage: npm run sim-fake -- <origin> <destination> [--base http://127.0.0.1:3080] [--speed 30] [--title ...] [--livery ...]");
  process.exit(1);
}

const fromCode = args.from;
const toCode = args.to;
const { base, speed, title, livery, atc } = args;
const cruiseKts = args.cruise;
const cruiseAlt = args.alt;
const landingFpm = args.fpm;
const landingG = args.g;
/** Fuel on board at the start and a flat burn, pounds. */
const FUEL_START_LB = 300;
const BURN_LB_PER_HOUR = 60;
const EMPTY_WEIGHT_LB = 2100;

interface Airport {
  ident: string;
  lat: number;
  lon: number;
  elevation_ft: number | null;
}

interface Sample {
  t: number;
  lat: number;
  lon: number;
  alt_ft: number;
  on_ground: boolean;
  gs_kts: number;
  hdg_deg: number;
  vs_fpm: number;
  ias_kts: number;
  g: number;
  fuel_lb: number;
  weight_lb: number;
  title: string;
  livery: string;
  atc_id: string;
  touchdown?: { t: number; fpm: number; g: number; ias_kts: number; sim_fpm: number; pitch_deg: number; bank_deg: number };
}

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

function distanceNm(a: Airport, b: Airport): number {
  const h =
    Math.sin(toRad(b.lat - a.lat) / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lon - a.lon) / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h))) * 3440.065;
}

function bearing(a: Airport, b: Airport): number {
  const y = Math.sin(toRad(b.lon - a.lon)) * Math.cos(toRad(b.lat));
  const x = Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) - Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(toRad(b.lon - a.lon));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Point a fraction `f` of the way along the great circle from a to b. */
function along(a: Airport, b: Airport, f: number): [number, number] {
  const d = distanceNm(a, b) / 3440.065;
  if (d < 1e-6) return [a.lat, a.lon];
  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const lat1 = toRad(a.lat), lon1 = toRad(a.lon), lat2 = toRad(b.lat), lon2 = toRad(b.lon);
  const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
  const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
  const z = A * Math.sin(lat1) + B * Math.sin(lat2);
  return [toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))), toDeg(Math.atan2(y, x))];
}

async function getAirport(code: string): Promise<Airport> {
  const r = await fetch(`${base}/api/airports/${encodeURIComponent(code)}`);
  if (!r.ok) throw new Error(`airport ${code}: ${r.status} ${await r.text()}`);
  return (await r.json()) as Airport;
}

function buildFlight(from: Airport, to: Airport): Sample[] {
  const out: Sample[] = [];
  const dist = distanceNm(from, to);
  const hdg = bearing(from, to);
  const fromElev = from.elevation_ft ?? 0;
  const toElev = to.elevation_ft ?? 0;
  const ident = { title, livery, atc_id: atc };
  const push = (lat: number, lon: number, alt: number, ground: boolean, gs: number) => {
    const prev = out[out.length - 1];
    const vs = prev ? (alt - prev.alt_ft) * 60 : 0;
    const fuel = FUEL_START_LB - (BURN_LB_PER_HOUR * out.length) / 3600;
    const s: Sample = {
      t: out.length,
      lat,
      lon,
      alt_ft: alt,
      on_ground: ground,
      gs_kts: gs,
      hdg_deg: hdg,
      vs_fpm: vs,
      ias_kts: gs,
      g: 1,
      fuel_lb: fuel,
      weight_lb: EMPTY_WEIGHT_LB + fuel,
      ...ident,
    };
    // The first on-ground sample after flight carries what the frame watcher would have measured.
    if (ground && prev && !prev.on_ground) {
      s.g = landingG;
      s.touchdown = { t: out.length, fpm: landingFpm, g: landingG, ias_kts: gs, sim_fpm: landingFpm + 10, pitch_deg: 4.2, bank_deg: -0.6 };
    }
    out.push(s);
  };

  if (!args.startAirborne) {
    for (let i = 0; i < 20; i++) push(from.lat, from.lon, fromElev, true, 0); // parked
    for (let i = 0; i < 20; i++) push(from.lat, from.lon, fromElev, true, 15); // taxi
    for (let i = 0; i < 20; i++) push(from.lat, from.lon, fromElev, true, (70 * i) / 20); // takeoff roll
  }

  // Airborne: climb at 700 fpm, cruise, descend at 500 fpm to arrive at field elevation.
  let flown = args.startAirborne ? dist * 0.5 : 0;
  let alt = args.startAirborne ? cruiseAlt : fromElev;
  const nmPerSec = cruiseKts / 3600;
  const descentNm = ((cruiseAlt - toElev) / 500) * (cruiseKts / 60);
  while (flown < dist) {
    flown += nmPerSec;
    const remaining = dist - flown;
    if (remaining <= descentNm) alt = Math.max(toElev, alt - 500 / 60);
    else alt = Math.min(cruiseAlt, alt + 700 / 60);
    const [lat, lon] = along(from, to, Math.min(1, flown / dist));
    push(lat, lon, alt, false, cruiseKts);
  }

  if (args.touchAndGo) {
    for (let i = 0; i < 5; i++) push(to.lat, to.lon, toElev, true, 60); // wheels on
    for (let i = 0; i < 90; i++) push(to.lat, to.lon, toElev + 300, false, 90); // around the pattern
  }
  for (let i = 0; i < 20; i++) push(to.lat, to.lon, toElev, true, 60 - 3 * i); // rollout
  for (let i = 0; i < 20; i++) push(to.lat, to.lon, toElev, true, 8); // taxi in
  for (let i = 0; i < 45; i++) push(to.lat, to.lon, toElev, true, 0); // parked
  return out;
}

async function main() {
  const [from, to] = await Promise.all([getAirport(fromCode), getAirport(toCode)]);
  const samples = buildFlight(from, to);
  const start = Date.now() - samples.length * 1000;
  console.log(
    `${from.ident} → ${to.ident}: ${Math.round(distanceNm(from, to))} nm, ${samples.length} virtual seconds at ${speed}x ` +
      `(${Math.round(samples.length / speed)} s real)`,
  );
  let lastPhase = "";
  for (const s of samples) {
    const body = { ...s, t: start + s.t * 1000, touchdown: s.touchdown ? { ...s.touchdown, t: start + s.touchdown.t * 1000 } : undefined };
    const r = await fetch(`${base}/api/tracker/sample`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) {
      console.error(`server said ${r.status}: ${await r.text()}`);
      process.exit(1);
    }
    const st = (await r.json()) as { phase: string; message: string | null };
    const line = `${st.phase}${st.message ? ` — ${st.message}` : ""}`;
    if (line !== lastPhase) {
      console.log(`[${s.t}s] ${line}`);
      lastPhase = line;
    }
    await new Promise((res) => setTimeout(res, 1000 / speed));
  }
  console.log("done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
