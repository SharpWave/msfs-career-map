import { useState } from "react";
import { api } from "../api";
import { BUILTIN_ICONS, BUILTIN_KEYS, PALETTE, builtinSvg, iconInnerHtml, nextColor } from "../icons";
import type { Aircraft } from "../types";

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
  const [busy, setBusy] = useState(false);
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
    setBusy(true);
    try {
      const body = { name: name.trim(), livery: livery.trim(), color, icon, notes: notes.trim() };
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
