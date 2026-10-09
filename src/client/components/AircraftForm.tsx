import { useEffect, useState } from "react";
import { api } from "../api";
import { BUILTIN_ICONS, BUILTIN_KEYS, PALETTE, builtinSvg, iconInnerHtml, nextColor } from "../icons";
import { COMMON_TYPES } from "../simbrief";
import type { Aircraft } from "../types";

type PerfKey = "cruise_alt_ft" | "climb_fpm" | "climb_kts" | "descent_fpm" | "overhead_min";

/** Typical block-time numbers by class; climb speed is a fraction of cruise. */
const PERF_PRESETS = [
  { label: "Piston single", alt: 6500, climb: 700, climbFrac: 0.65, descent: 500, overhead: 12 },
  { label: "Piston twin", alt: 8000, climb: 1000, climbFrac: 0.7, descent: 700, overhead: 12 },
  { label: "Turboprop", alt: 24000, climb: 1500, climbFrac: 0.6, descent: 1500, overhead: 15 },
  { label: "Light jet", alt: 37000, climb: 2500, climbFrac: 0.6, descent: 2000, overhead: 15 },
  { label: "Airliner", alt: 35000, climb: 2000, climbFrac: 0.6, descent: 2000, overhead: 20 },
  { label: "Helicopter", alt: 2000, climb: 800, climbFrac: 0.8, descent: 500, overhead: 8 },
] as const;

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
    return () => {
      cancelled = true;
    };
  }, []);

  const typeName = typeList.find(([code]) => code === simbriefType.trim().toUpperCase())?.[1];
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
