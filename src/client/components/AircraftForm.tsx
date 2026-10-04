import { useEffect, useState } from "react";
import { api } from "../api";
import { BUILTIN_ICONS, BUILTIN_KEYS, PALETTE, builtinSvg, iconInnerHtml, nextColor } from "../icons";
import { COMMON_TYPES } from "../simbrief";
import type { Aircraft } from "../types";

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

interface Props {
  initial?: Aircraft;
  usedColors: string[];
  onSaved: () => void | Promise<void>;
  onCancel: () => void;
  onDeleted?: () => void | Promise<void>;
}

export function AircraftForm({ initial, usedColors, onSaved, onCancel, onDeleted }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [livery, setLivery] = useState(initial?.livery ?? "");
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
  const [typeList, setTypeList] = useState<[string, string][]>(COMMON_TYPES);
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
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="A2A Aerostar 600" autoFocus />
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
