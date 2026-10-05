/**
 * Flies a synthetic leg through the tracker so the whole pipeline can be tested without the sim.
 * The server must be started with TRACKER_FAKE=1 (which also skips the real SimConnect link).
 *
 *   npm run sim-fake -- KBOS KPVD
 *   npm run sim-fake -- KBOS KPVD --speed 60 --title "Cessna 172 Skyhawk" --livery "N123AB" --atc N123AB
 *
 * Options: --speed N (virtual seconds per real second, default 30), --cruise KTS (150),
 * --alt FT (6500), --base URL (http://localhost:3080), --touch-and-go (bounce once at the
 * destination before the full stop), --start-airborne (begin mid-flight, no departure airport).
 */

const args = process.argv.slice(2);
const opt = (name: string, def: string): string => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : def;
};
const flag = (name: string) => args.includes(`--${name}`);
const positional = args.filter((a, i) => !a.startsWith("--") && (i === 0 || !args[i - 1].startsWith("--") || flag(args[i - 1].slice(2))));

const [fromCode, toCode] = positional;
if (!fromCode || !toCode) {
  console.error("usage: npm run sim-fake -- <origin> <destination> [--speed 30] [--title ...] [--livery ...]");
  process.exit(1);
}

const base = opt("base", "http://localhost:3080").replace(/\/$/, "");
const speed = Number(opt("speed", "30"));
const cruiseKts = Number(opt("cruise", "150"));
const cruiseAlt = Number(opt("alt", "6500"));
const title = opt("title", "Fake Aircraft");
const livery = opt("livery", "");
const atc = opt("atc", livery || "N000FK");

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
  title: string;
  livery: string;
  atc_id: string;
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
  const push = (lat: number, lon: number, alt: number, ground: boolean, gs: number) =>
    out.push({ t: out.length, lat, lon, alt_ft: alt, on_ground: ground, gs_kts: gs, hdg_deg: hdg, ...ident });

  if (!flag("start-airborne")) {
    for (let i = 0; i < 20; i++) push(from.lat, from.lon, fromElev, true, 0); // parked
    for (let i = 0; i < 20; i++) push(from.lat, from.lon, fromElev, true, 15); // taxi
    for (let i = 0; i < 20; i++) push(from.lat, from.lon, fromElev, true, (70 * i) / 20); // takeoff roll
  }

  // Airborne: climb at 700 fpm, cruise, descend at 500 fpm to arrive at field elevation.
  let flown = flag("start-airborne") ? dist * 0.5 : 0;
  let alt = flag("start-airborne") ? cruiseAlt : fromElev;
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

  if (flag("touch-and-go")) {
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
    const body = { ...s, t: start + s.t * 1000 };
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
