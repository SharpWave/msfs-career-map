import { useEffect, useState, type ReactNode } from "react";
import { useMap } from "react-leaflet";
import { api } from "../api";
import { airportWhere } from "../format";
import { metarStation } from "../metar";
import { simbriefUrl, type SimbriefLeg } from "../simbrief";
import type { Airport, Metar, WikiSummary } from "../types";
import { RunwayInfo } from "./RunwayInfo";

interface Props {
  airport: Airport;
  /** Extra line under the runways, e.g. the planner's distance/time. */
  extra?: ReactNode;
  /** When given, shows a "use as next destination" button. */
  onUse?: () => void;
  /** When given, adds a SimBrief link that starts a flight plan for this leg. */
  simbrief?: SimbriefLeg;
}

/**
 * Click popup for an airport: Wikipedia image + blurb, live METAR, runways, outbound links.
 * Mounted only while the popup is open, so the fetches happen on demand.
 */
export function AirportPopup({ airport, extra, onUse, simbrief }: Props) {
  const map = useMap();
  const [wiki, setWiki] = useState<WikiSummary | null | "loading">("loading");
  const [metar, setMetar] = useState<Metar | null | "loading">("loading");
  const [detail, setDetail] = useState<Airport | null>(null);
  const station = metarStation(airport);

  // Planner candidates arrive without their runway list; fetch it when the popup opens.
  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    if (!airport.runways && airport.rwy_count > 0) {
      api
        .getAirport(airport.ident)
        .then((a) => !cancelled && setDetail(a))
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
  }, [airport.ident, airport.runways, airport.rwy_count]);

  useEffect(() => {
    let cancelled = false;
    setWiki(airport.wikipedia_link ? "loading" : null);
    setMetar(station ? "loading" : null);
    if (airport.wikipedia_link) {
      api
        .wiki(airport.ident)
        .then((w) => !cancelled && setWiki(w))
        .catch(() => !cancelled && setWiki(null));
    }
    if (station) {
      api
        .metar(station)
        .then((m) => !cancelled && setMetar(m))
        .catch(() => !cancelled && setMetar(null));
    }
    return () => {
      cancelled = true;
    };
  }, [airport.ident, airport.wikipedia_link, station]);

  const where = airportWhere(airport);
  const wikiUrl = (wiki !== "loading" && wiki?.url) || airport.wikipedia_link;

  return (
    <div className="apop">
      <div className="apop-head">
        <div className="tip-title">
          {airport.ident} · {airport.name}
        </div>
        {where && <div className="tip-sub">{where}</div>}
      </div>

      {wiki !== "loading" && wiki?.thumbnail && (
        <a href={wikiUrl ?? undefined} target="_blank" rel="noreferrer" className="apop-img" title={wiki.title ?? "Wikipedia"}>
          <img src={wiki.thumbnail} alt={wiki.title ?? airport.name} />
        </a>
      )}

      <RunwayInfo airport={detail ?? airport} max={5} />
      {extra}

      {station && (
        <div className="apop-metar">
          {metar === "loading" && <div className="muted small">Fetching METAR…</div>}
          {metar === null && <div className="muted small">No current METAR for {station}.</div>}
          {metar !== "loading" && metar && <MetarBlock m={metar} />}
        </div>
      )}

      {wiki !== "loading" && wiki?.extract && <p className="apop-extract">{clip(wiki.extract, 260)}</p>}

      <div className="apop-links">
        {simbrief && (
          <a
            href={simbriefUrl(simbrief)}
            target="_blank"
            rel="noreferrer"
            className="sb"
            title={
              simbrief.type
                ? `Start a SimBrief plan ${simbrief.orig} → ${simbrief.dest} as ${simbrief.type}`
                : `Start a SimBrief plan ${simbrief.orig} → ${simbrief.dest} (set a SimBrief type on the aircraft to pre-fill it)`
            }
          >
            SimBrief
          </a>
        )}
        {wikiUrl && (
          <a href={wikiUrl} target="_blank" rel="noreferrer">
            Wikipedia
          </a>
        )}
        {airport.home_link && (
          <a href={airport.home_link} target="_blank" rel="noreferrer">
            Official site
          </a>
        )}
        <a href={`https://skyvector.com/airport/${encodeURIComponent(airport.ident)}`} target="_blank" rel="noreferrer">
          SkyVector
        </a>
        {station && (
          <a href={`https://aviationweather.gov/data/metar/?ids=${station}&decoded=yes`} target="_blank" rel="noreferrer">
            METAR/TAF
          </a>
        )}
      </div>

      {onUse && (
        <button
          type="button"
          className="primary small apop-use"
          onClick={() => {
            onUse();
            map.closePopup();
          }}
        >
          Use as next destination
        </button>
      )}
    </div>
  );
}

function clip(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  return cut.slice(0, Math.max(cut.lastIndexOf(". ") + 1, cut.lastIndexOf(" "))).trimEnd() + "…";
}

function MetarBlock({ m }: { m: Metar }) {
  const cat = m.flight_category ?? "—";
  let wind = "wind n/a";
  if (m.wind_kts === 0) wind = "calm";
  else if (m.wind_kts != null) {
    const dir = typeof m.wind_dir === "number" ? `${m.wind_dir.toString().padStart(3, "0")}°` : m.wind_dir ?? "VRB";
    wind = `${dir} ${m.wind_kts} kt${m.gust_kts ? ` G${m.gust_kts}` : ""}`;
  }
  const vis = m.visibility ? `${m.visibility} SM` : null;
  const temp = m.temp_c != null ? `${Math.round(m.temp_c)}°C${m.dewpoint_c != null ? `/${Math.round(m.dewpoint_c)}°C` : ""}` : null;
  const alt = m.altimeter_hpa != null ? `${(m.altimeter_hpa * 0.02953).toFixed(2)} inHg` : null;
  const age = m.observed_at ? Math.round((Date.now() - new Date(m.observed_at).getTime()) / 60000) : null;
  const ceiling = m.clouds.find((c) => c.cover === "BKN" || c.cover === "OVC" || c.cover === "OVX");
  return (
    <>
      <div className="metar-line">
        <span className={`fltcat fltcat-${cat}`}>{cat}</span>
        <span>{[wind, vis, ceiling ? `${ceiling.cover} ${ceiling.base_ft ?? "?"} ft` : m.clouds.length === 0 ? "clear" : null, temp, alt].filter(Boolean).join(" · ")}</span>
      </div>
      <code className="metar-raw">{m.raw}</code>
      {age != null && <div className="muted small">observed {age} min ago</div>}
    </>
  );
}
