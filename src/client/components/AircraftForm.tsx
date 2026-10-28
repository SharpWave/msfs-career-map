import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { BUILTIN_ICONS, BUILTIN_KEYS, PALETTE, builtinSvg, iconInnerHtml, nextColor } from "../icons";
import { PERF_PRESETS, presetByLabel } from "../presets";
import { COMMON_TYPES } from "../simbrief";
import type { Aircraft, AircraftTypeEntry, TableNumberField, TableProvenance } from "../types";

type PerfKey = "cruise_alt_ft" | "climb_fpm" | "climb_kts" | "descent_fpm" | "overhead_min";

const PERF_FIELDS: { key: PerfKey; label: string; placeholder: string }[] = [
  { key: "cruise_alt_ft", label: "Typical cruise altitude, ft", placeholder: "6500" },
  { key: "climb_fpm", label: "Climb rate, fpm", placeholder: "700" },
  { key: "climb_kts", label: "Climb speed, kts", placeholder: "65% of cruise" },
  { key: "descent_fpm", label: "Descent rate, fpm", placeholder: "500" },
  { key: "overhead_min", label: "Taxi + approach, min", placeholder: "12" },
];

/** SimBrief's full aircraft list, fetched once per page load and shared by every form instance. */
let typeListPromise: Promise<[string, string][]> | null = null;
function loadSimbriefTypes(): Promise<[string, string][]> {
  if (!typeListPromise) {
    typeListPromise = api
      .simbriefTypes()
      .then((r) => r.types.map((t) => [t.id, t.name] as [string, string]))
      .catch(() => {
        typeListPromise = null;
        return COMMON_TYPES;
      });
  }
  return typeListPromise;
}

/** The performance table's types and names, fetched once per page load; null when it could not be loaded. */
let tableTypesPromise: Promise<Map<string, string> | null> | null = null;
function loadTableTypes(): Promise<Map<string, string> | null> {
  tableTypesPromise ??= api
    .aircraftTypes()
    .then((l) => new Map(l.types.map((t) => [t.type, t.name])))
    .catch(() => null);
  return tableTypesPromise;
}

/** The form's label for each number the table gives, as the Sources panel names them. */
const TABLE_LABELS: Record<TableNumberField, string> = {
  cruise_kts: "Cruise speed, kts",
  min_runway_ft: "Min runway, ft",
  ceiling_ft: "Service ceiling, ft",
  max_xwind_kts: "Max crosswind, kt",
  cruise_alt_ft: "Typical cruise altitude, ft",
  climb_fpm: "Climb rate, fpm",
  climb_kts: "Climb speed, kts",
  descent_fpm: "Descent rate, fpm",
};
const TABLE_FIELDS = Object.keys(TABLE_LABELS) as TableNumberField[];
const ENTRY_FAILED = "Couldn't load the performance table entry.";

/** Starting values for a new aircraft, e.g. taken from what the sim reports. */
export interface AircraftPrefill {
  name?: string;
  livery?: string;
  sim_title?: string | null;
  sim_livery?: string | null;
}

interface Props {
  initial?: Aircraft;
  prefill?: AircraftPrefill;
  usedColors: string[];
  onSaved: () => void | Promise<void>;
  onCancel: () => void;
  onDeleted?: () => void | Promise<void>;
}

export function AircraftForm({ initial, prefill, usedColors, onSaved, onCancel, onDeleted }: Props) {
  const [name, setName] = useState(initial?.name ?? prefill?.name ?? "");
  const [livery, setLivery] = useState(initial?.livery ?? prefill?.livery ?? "");
  const [simTitle, setSimTitle] = useState(initial?.sim_title ?? prefill?.sim_title ?? "");
  const [simLivery, setSimLivery] = useState(initial?.sim_livery ?? prefill?.sim_livery ?? "");
  const [color, setColor] = useState(initial?.color ?? nextColor(usedColors));
  const [icon, setIcon] = useState(initial?.icon ?? "builtin:twin-piston");
  const [urlText, setUrlText] = useState(initial?.icon.startsWith("http") ? initial.icon : "");
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [cruise, setCruise] = useState(initial?.cruise_kts?.toString() ?? "");
  const [minRunway, setMinRunway] = useState(initial?.min_runway_ft?.toString() ?? "");
  const [simbriefType, setSimbriefType] = useState(initial?.simbrief_type ?? "");
  const [airline, setAirline] = useState(initial?.airline ?? "");
  const [ceiling, setCeiling] = useState(initial?.ceiling_ft?.toString() ?? "");
  const [maxXwind, setMaxXwind] = useState(initial?.max_xwind_kts?.toString() ?? "");
  const [oxygen, setOxygen] = useState(!!initial?.oxygen);
  const [ifrCapable, setIfrCapable] = useState(initial ? !!initial.ifr_capable : true);
  const [perf, setPerf] = useState<Record<PerfKey, string>>({
    cruise_alt_ft: initial?.cruise_alt_ft?.toString() ?? "",
    climb_fpm: initial?.climb_fpm?.toString() ?? "",
    climb_kts: initial?.climb_kts?.toString() ?? "",
    descent_fpm: initial?.descent_fpm?.toString() ?? "",
    overhead_min: initial?.overhead_min?.toString() ?? "",
  });
  const [typeList, setTypeList] = useState<[string, string][]>(COMMON_TYPES);
  const [tableTypes, setTableTypes] = useState<Map<string, string> | null>(null);
  const [fillNote, setFillNote] = useState<string | null>(null);
  const [entryError, setEntryError] = useState<string | null>(null);
  const [sources, setSources] = useState<AircraftTypeEntry | null>(null);

  const applyPreset = (p: (typeof PERF_PRESETS)[number]) => {
    const kts = Number(cruise) || 0;
    setPerf({
      cruise_alt_ft: String(p.alt),
      climb_fpm: String(p.climb),
      climb_kts: kts ? String(Math.round(kts * p.climbFrac)) : "",
      descent_fpm: String(p.descent),
      overhead_min: String(p.overhead),
    });
  };
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadSimbriefTypes().then((l) => !cancelled && setTypeList(l));
    loadTableTypes().then((t) => !cancelled && setTableTypes(t));
    return () => {
      cancelled = true;
    };
  }, []);

  const sbCode = simbriefType.trim().toUpperCase();
  // The type the form names now, so an entry that arrives after it changed is dropped (FLEET-TYPE-015).
  const sbCodeNow = useRef(sbCode);
  sbCodeNow.current = sbCode;
  // The form's values as they stand, read when an entry arrives, so typing during the fetch is kept.
  const live = useRef({ cruise, minRunway, ceiling, maxXwind, perf, icon, pendingImage, urlText });
  live.current = { cruise, minRunway, ceiling, maxXwind, perf, icon, pendingImage, urlText };
  const inTable = tableTypes?.has(sbCode) ?? false;
  const typeName = typeList.find(([code]) => code === sbCode)?.[1] ?? tableTypes?.get(sbCode);

  /** The type's entry, or null when it is no longer the form's type or could not be fetched (said so). */
  const fetchEntry = async (code: string): Promise<AircraftTypeEntry | null> => {
    setEntryError(null);
    try {
      const entry = await api.aircraftType(code);
      return sbCodeNow.current === code ? entry : null;
    } catch {
      if (sbCodeNow.current === code) setEntryError(ENTRY_FAILED);
      return null;
    }
  };

  /** Fill from table: researched numbers replace, class figures fill blanks only; nothing is saved. */
  // @spec FLEET-TYPE-013, FLEET-TYPE-014, FLEET-TYPE-015, FLEET-TYPE-016
  const fillFromTable = async () => {
    const entry = await fetchEntry(sbCode);
    if (!entry) return;
    const { cruise, minRunway, ceiling, maxXwind, perf, icon, pendingImage, urlText } = live.current;
    const now: Record<TableNumberField | "overhead_min", string> = {
      cruise_kts: cruise,
      min_runway_ft: minRunway,
      ceiling_ft: ceiling,
      max_xwind_kts: maxXwind,
      cruise_alt_ft: perf.cruise_alt_ft,
      climb_fpm: perf.climb_fpm,
      climb_kts: perf.climb_kts,
      descent_fpm: perf.descent_fpm,
      overhead_min: perf.overhead_min,
    };
    const next = { ...now };
    for (const f of TABLE_FIELDS) {
      const p = entry.values[f];
      if (!p || ((p.kind === "preset" || p.kind === "estimated") && now[f].trim() !== "")) continue;
      next[f] = String(p.value);
    }
    const preset = presetByLabel(entry.preset);
    if (preset && now.overhead_min.trim() === "") next.overhead_min = String(preset.overhead);
    const filled = (Object.keys(now) as (keyof typeof now)[]).filter((k) => next[k] !== now[k]).length;
    setCruise(next.cruise_kts);
    setMinRunway(next.min_runway_ft);
    setCeiling(next.ceiling_ft);
    setMaxXwind(next.max_xwind_kts);
    setPerf({
      cruise_alt_ft: next.cruise_alt_ft,
      climb_fpm: next.climb_fpm,
      climb_kts: next.climb_kts,
      descent_fpm: next.descent_fpm,
      overhead_min: next.overhead_min,
    });
    if (entry.pressurised?.value === true) setOxygen(true);
    if (icon.startsWith("builtin:") && !pendingImage && urlText.trim() === "") setIcon(`builtin:${entry.icon}`);
    setFillNote(`Filled ${filled} ${filled === 1 ? "value" : "values"} from ${entry.name}`);
  };

  // @spec FLEET-TYPE-017
  const toggleSources = async () => {
    if (sources) return setSources(null);
    const entry = await fetchEntry(sbCode);
    if (entry) setSources(entry);
  };
  const [error, setError] = useState<string | null>(null);

  const chooseFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) return setError("Image must be under 4 MB.");
    const reader = new FileReader();
    reader.onload = () => {
      setPendingImage(String(reader.result));
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const applyUrl = () => {
    const u = urlText.trim();
    if (u) {
      setIcon(u);
      setPendingImage(null);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Name is required.");
    const cruiseKts = cruise.trim() === "" ? null : Number(cruise);
    if (cruiseKts !== null && (!Number.isFinite(cruiseKts) || cruiseKts <= 0)) return setError("Cruise speed must be a positive number of knots.");
    const minRunwayFt = minRunway.trim() === "" ? null : Number(minRunway);
    if (minRunwayFt !== null && (!Number.isFinite(minRunwayFt) || minRunwayFt < 0)) return setError("Minimum runway must be a number of feet.");
    const sbType = simbriefType.trim().toUpperCase();
    if (sbType && !/^[A-Z0-9]{2,6}$/.test(sbType)) return setError("SimBrief type should be an ICAO designator like C172 or TBM8.");
    const airlineCode = airline.trim().toUpperCase();
    if (airlineCode && !/^[A-Z]{3}$/.test(airlineCode)) return setError("Airline must be a three-letter ICAO airline code");
    const ceilingFt = ceiling.trim() === "" ? null : Number(ceiling);
    if (ceilingFt !== null && (!Number.isFinite(ceilingFt) || ceilingFt < 0)) return setError("Service ceiling must be a number of feet.");
    const maxXwindKts = maxXwind.trim() === "" ? null : Number(maxXwind);
    if (maxXwindKts !== null && (!Number.isFinite(maxXwindKts) || maxXwindKts < 0)) return setError("Max crosswind must be a number of knots.");
    const perfNums = {} as Record<PerfKey, number | null>;
    for (const f of PERF_FIELDS) {
      const v = perf[f.key].trim();
      const n = v === "" ? null : Number(v);
      if (n !== null && (!Number.isFinite(n) || n < 0)) return setError(`${f.label} must be a number.`);
      perfNums[f.key] = n;
    }
    setBusy(true);
    try {
      const body = {
        name: name.trim(),
        livery: livery.trim(),
        color,
        icon,
        notes: notes.trim(),
        cruise_kts: cruiseKts,
        min_runway_ft: minRunwayFt,
        simbrief_type: sbType || null,
        airline: airlineCode || null,
        ceiling_ft: ceilingFt,
        oxygen,
        max_xwind_kts: maxXwindKts,
        ifr_capable: ifrCapable,
        ...perfNums,
        sim_title: simTitle.trim() || null,
        sim_livery: simLivery.trim() || null,
      };
      const saved = initial ? await api.updateAircraft(initial.id, body) : await api.createAircraft(body);
      if (pendingImage) await api.uploadIcon(saved.id, pendingImage);
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!initial) return;
    if (!window.confirm(`Delete ${initial.name}${initial.livery ? ` (${initial.livery})` : ""} and all of its hops?`)) return;
    setBusy(true);
    try {
      await api.deleteAircraft(initial.id);
      await onDeleted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const previewHtml = pendingImage
    ? `<img src="${pendingImage}" alt="preview" />`
    : iconInnerHtml({ icon, name: name || "aircraft" });

  return (
    <form className="aircraft-form" onSubmit={submit}>
      <div className="preview-row">
        <div className="plane-head big" style={{ "--c": color } as React.CSSProperties} dangerouslySetInnerHTML={{ __html: previewHtml }} />
        <div className="grow">
          <label>
            <span>Aircraft</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="A2A Aerostar 600" autoFocus data-handoff-focus="" />
          </label>
          <label>
            <span>Livery / registration</span>
            <input value={livery} onChange={(e) => setLivery(e.target.value)} placeholder="N6017Y" />
          </label>
        </div>
      </div>

      <label>
        <span>Path color</span>
        <div className="palette">
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} title="Custom color" />
          {PALETTE.map((c) => (
            <button
              type="button"
              key={c}
              className={`swatch${c === color.toLowerCase() ? " on" : ""}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
              title={c}
            />
          ))}
        </div>
      </label>

      <label>
        <span>Icon</span>
        <div className="icon-grid">
          {BUILTIN_KEYS.map((k) => (
            <button
              type="button"
              key={k}
              className={`icon-choice${!pendingImage && icon === `builtin:${k}` ? " on" : ""}`}
              style={{ color }}
              title={BUILTIN_ICONS[k].label}
              onClick={() => {
                setIcon(`builtin:${k}`);
                setPendingImage(null);
              }}
              dangerouslySetInnerHTML={{ __html: builtinSvg(k) }}
            />
          ))}
        </div>
      </label>

      <div className="two">
        <label>
          <span>…or upload an image</span>
          <input type="file" accept="image/*" onChange={(e) => chooseFile(e.target.files?.[0])} />
        </label>
        <label>
          <span>…or image URL</span>
          <input
            type="url"
            value={urlText}
            onChange={(e) => setUrlText(e.target.value)}
            onBlur={applyUrl}
            placeholder="https://…/aerostar.png"
          />
        </label>
      </div>

      <div className="two">
        <label>
          <span>
            Cruise speed, kts <em>(unlocks the planner)</em>
          </span>
          <input type="number" min={1} step={1} value={cruise} onChange={(e) => setCruise(e.target.value)} placeholder="e.g. 190" />
        </label>
        <label>
          <span>
            Min runway, ft <em>(optional filter)</em>
          </span>
          <input type="number" min={0} step={1} value={minRunway} onChange={(e) => setMinRunway(e.target.value)} placeholder="e.g. 3000" />
        </label>
      </div>

      <div className="two">
        <label>
          <span>
            Service ceiling, ft <em>(optional)</em>
          </span>
          <input type="number" min={0} step={1} value={ceiling} onChange={(e) => setCeiling(e.target.value)} placeholder="e.g. 25000" />
        </label>
        <label>
          <span>
            Max crosswind, kt <em>(optional)</em>
          </span>
          <input type="number" min={0} step={1} value={maxXwind} onChange={(e) => setMaxXwind(e.target.value)} placeholder="e.g. 20" />
        </label>
      </div>

      <fieldset className="perf">
        <legend>
          Block-time model <em className="muted">(climb/descent/taxi; blank = light-piston defaults)</em>
        </legend>
        <div className="quick">
          {PERF_PRESETS.map((p) => (
            <button type="button" key={p.label} className="chip" onClick={() => applyPreset(p)} title="Fill the fields below with typical numbers for this class">
              {p.label}
            </button>
          ))}
        </div>
        <div className="perf-grid">
          {PERF_FIELDS.map((f) => (
            <label key={f.key}>
              <span>{f.label}</span>
              <input
                type="number"
                min={0}
                step={1}
                value={perf[f.key]}
                placeholder={f.placeholder}
                onChange={(e) => setPerf((s) => ({ ...s, [f.key]: e.target.value }))}
              />
            </label>
          ))}
        </div>
      </fieldset>

      <div className="type-row">
        <label className="check">
          <input type="checkbox" checked={oxygen} onChange={(e) => setOxygen(e.target.checked)} />
          <span>Pressurised / has oxygen (may cruise above 12,000 ft)</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={ifrCapable} onChange={(e) => setIfrCapable(e.target.checked)} />
          <span>IFR capable</span>
        </label>
      </div>

      {/* @spec FLEET-SIM-005 */}
      <div className="type-airline">
        <label>
          <span>
            SimBrief aircraft type <em>(ICAO designator, pre-fills SimBrief links)</em>
          </span>
          <input
            className="code"
            list="simbrief-types"
            value={simbriefType}
            onChange={(e) => setSimbriefType(e.target.value.toUpperCase())}
            placeholder="e.g. AEST, PA24, TBM8"
            maxLength={6}
            spellCheck={false}
          />
          <datalist id="simbrief-types">
            {typeList.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </datalist>
          <div className={`hint${simbriefType && !typeName ? " bad" : ""}`}>
            {typeName ?? (simbriefType ? "Not in SimBrief's list (it may still accept it)" : `${typeList.length} types; type a code or name to search`)}
          </div>
        </label>
        <label>
          <span>
            Airline <em>(ICAO code)</em>
          </span>
          <input
            className="code"
            value={airline}
            onChange={(e) => setAirline(e.target.value.toUpperCase())}
            placeholder="e.g. JBU"
            maxLength={3}
            spellCheck={false}
          />
        </label>
      </div>

      {/* @spec FLEET-SIM-004, FLEET-TYPE-012 */}
      {(inTable || fillNote || entryError) && (
        <div className="type-table">
          {inTable && (
            <>
              <button type="button" className="chip" onClick={fillFromTable} title="Fill the numbers below from the app's performance table for this type">
                Fill from table
              </button>
              <button type="button" className={`chip${sources ? " on" : ""}`} onClick={toggleSources}>
                Sources
              </button>
            </>
          )}
          {fillNote && <span className="hint">{fillNote}</span>}
          {entryError && <span className="hint bad">{entryError}</span>}
        </div>
      )}
      {sources && sources.type === sbCode && <TypeSources entry={sources} names={tableTypes} />}

      <div className="two">
        <label>
          <span>
            Sim aircraft title <em>(live tracking)</em>
          </span>
          <input value={simTitle} onChange={(e) => setSimTitle(e.target.value)} placeholder="TITLE as the sim reports it" spellCheck={false} />
        </label>
        <label>
          <span>
            Sim livery <em>(blank = any livery)</em>
          </span>
          <input value={simLivery} onChange={(e) => setSimLivery(e.target.value)} placeholder="LIVERY NAME" spellCheck={false} />
        </label>
      </div>
      <div className="muted small">The Live panel’s Bind button fills these from the sim; flights in that aircraft are then logged here.</div>

      <label>
        <span>Notes</span>
        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="engine hours, quirks, goals…" />
      </label>

      {error && <div className="error">{error}</div>}

      <div className="actions">
        <button type="submit" className="primary" disabled={busy}>
          {initial ? "Save aircraft" : "Add aircraft"}
        </button>
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        {initial && (
          <button type="button" className="danger right" onClick={remove} disabled={busy}>
            Delete aircraft
          </button>
        )}
      </div>
    </form>
  );
}

/**
 * Where each of a type's numbers comes from: its sources, calculation, class preset or the similar type
 * it is estimated from, named from the table's list (FLEET-TYPE-017).
 */
function TypeSources({ entry, names }: { entry: AircraftTypeEntry; names: Map<string, string> | null }) {
  const rows: [string, TableProvenance<number | boolean>][] = [];
  for (const f of TABLE_FIELDS) {
    const p = entry.values[f];
    if (p) rows.push([TABLE_LABELS[f], p]);
  }
  if (entry.pressurised) rows.push(["Pressurised", entry.pressurised]);
  const source = (id: string) => entry.sources.find((s) => s.id === id);
  return (
    <section className="type-sources" aria-label={`Sources for ${entry.name}`}>
      <div>{entry.variant}</div>
      <div className="hint">
        Researched {entry.researched} · checked {entry.checked}
      </div>
      <ul>
        {rows.map(([label, p]) => (
          <li key={label}>
            <span className="label">{label}</span> <b>{typeof p.value === "boolean" ? (p.value ? "yes" : "no") : String(p.value)}</b>
            {p.kind === "preset" ? (
              <span className="muted"> — class preset ({entry.preset})</span>
            ) : p.kind === "estimated" ? (
              <span className="muted"> — estimated from {names?.get(p.from) ?? p.from}</span>
            ) : (
              p.sources.map((id) => {
                const s = source(id);
                return s ? (
                  <span key={id} className="muted">
                    {" — "}
                    <a href={s.url} target="_blank" rel="noopener noreferrer">
                      {s.title}
                    </a>
                    , {s.publisher}, {s.page}
                  </span>
                ) : null;
              })
            )}
            {p.kind === "derived" && <div className="hint">Calculation: {p.calculation}</div>}
            {p.note && <div className="hint">{p.note}</div>}
          </li>
        ))}
      </ul>
    </section>
  );
}
