import { useEffect, useState } from "react";
import { api } from "../api";
import { aircraftLabel, isoToLocalInput, localInputToIso } from "../format";
import type { Aircraft, Hop } from "../types";
import { AirportInput } from "./AirportInput";

interface Props {
  aircraft: Aircraft[];
  hops: Hop[];
  /** When set, the form edits this hop instead of creating a new one. */
  initial?: Hop;
  defaultAircraftId?: number | null;
  onSaved: () => void | Promise<void>;
  onCancel?: () => void;
}

export function HopForm({ aircraft, hops, initial, defaultAircraftId, onSaved, onCancel }: Props) {
  const isEdit = !!initial;

  /** Where an aircraft is currently parked: the destination of its last hop. */
  const lastDest = (aid: number) => {
    const hs = hops.filter((h) => h.aircraft_id === aid);
    return hs.length ? hs[hs.length - 1].dest : "";
  };

  const firstId = initial?.aircraft_id ?? defaultAircraftId ?? aircraft[0]?.id ?? 0;
  const [aircraftId, setAircraftId] = useState<number>(firstId);
  const [origin, setOrigin] = useState(initial?.origin ?? (firstId ? lastDest(firstId) : ""));
  const [dest, setDest] = useState(initial?.dest ?? "");
  const [departed, setDeparted] = useState(isoToLocalInput(initial?.departed_at));
  const [arrived, setArrived] = useState(isoToLocalInput(initial?.arrived_at));
  const [duration, setDuration] = useState(initial?.duration_min?.toString() ?? "");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const changeAircraft = (id: number) => {
    setAircraftId(id);
    if (!isEdit) setOrigin(lastDest(id));
  };

  // Clicking an aircraft in the fleet list retargets the "log a hop" form.
  useEffect(() => {
    if (!isEdit && defaultAircraftId && defaultAircraftId !== aircraftId) changeAircraft(defaultAircraftId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultAircraftId]);

  // If the chosen aircraft disappears (deleted), fall back to the first one.
  useEffect(() => {
    if (aircraft.length && !aircraft.some((a) => a.id === aircraftId)) changeAircraft(aircraft[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aircraft]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFlash(null);
    if (!aircraftId) return setError("Choose an aircraft.");
    if (!origin.trim()) return setError("Origin is required.");
    if (!dest.trim()) return setError("Destination is required.");
    const dep = localInputToIso(departed);
    const arr = localInputToIso(arrived);
    if (dep && arr && arr < dep) return setError("Arrival is before departure.");
    const dur = duration.trim() === "" ? null : Number(duration);
    if (dur !== null && (!Number.isFinite(dur) || dur < 0)) return setError("Duration must be a number of minutes.");

    const body = {
      aircraft_id: aircraftId,
      origin: origin.trim().toUpperCase(),
      dest: dest.trim().toUpperCase(),
      departed_at: dep,
      arrived_at: arr,
      duration_min: dur,
      notes: notes.trim(),
    };
    setBusy(true);
    try {
      if (isEdit) {
        await api.updateHop(initial!.id, body);
        await onSaved();
      } else {
        await api.createHop(body);
        await onSaved();
        // Ready for the next leg: this hop's destination becomes the next origin.
        setOrigin(body.dest);
        setDest("");
        setDeparted("");
        setArrived("");
        setDuration("");
        setNotes("");
        setFlash(`Logged ${body.origin} → ${body.dest}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!isEdit && aircraft.length === 0) {
    return <p className="muted">Add an aircraft to the fleet first, then log hops here.</p>;
  }

  return (
    <form className="hop-form" onSubmit={submit}>
      <label>
        <span>Aircraft</span>
        <select value={aircraftId} onChange={(e) => changeAircraft(Number(e.target.value))}>
          {aircraft.map((a) => (
            <option key={a.id} value={a.id}>
              {aircraftLabel(a)}
            </option>
          ))}
        </select>
      </label>

      <div className="two">
        <label>
          <span>From</span>
          <AirportInput value={origin} onChange={setOrigin} placeholder="KBOS" />
        </label>
        <label>
          <span>To</span>
          <AirportInput value={dest} onChange={setDest} placeholder="KHYA" autoFocus={!isEdit && !!origin} />
        </label>
      </div>

      <div className="two">
        <label>
          <span>Departed <em>(optional)</em></span>
          <input type="datetime-local" value={departed} onChange={(e) => setDeparted(e.target.value)} />
        </label>
        <label>
          <span>Arrived <em>(optional)</em></span>
          <input type="datetime-local" value={arrived} onChange={(e) => setArrived(e.target.value)} />
        </label>
      </div>

      <div className="two">
        <label>
          <span>Flight time, min <em>(optional)</em></span>
          <input type="number" min={0} step={1} value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="auto from times" />
        </label>
        <label>
          <span>Notes</span>
          <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="weather, squawks…" />
        </label>
      </div>

      {error && <div className="error">{error}</div>}
      {flash && !error && <div className="flash">{flash}</div>}

      <div className="actions">
        <button type="submit" className="primary" disabled={busy}>
          {isEdit ? "Save changes" : "Add hop"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
