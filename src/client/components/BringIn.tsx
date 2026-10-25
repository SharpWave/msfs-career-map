import { useEffect, useRef, useState } from "react";
import { api, type LogbookOffer, type OfferedLogbook } from "../api";
import { fmtDate, fmtDateTime } from "../format";
import { reloadPage } from "../navigation";
import { PAGE_TIMING } from "../notices";

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** How an offered logbook is named: a copy run from source by its folder, a backup by its date. */
const title = (o: OfferedLogbook) => (o.kind === "folder" ? o.folder : `Backup of ${fmtDateTime(o.time)}`);
const askName = (o: OfferedLogbook) => (o.kind === "folder" ? o.folder : `the backup of ${fmtDateTime(o.time)}`);

type Phase = null | "bringing" | "manual" | "late";

/**
 * The **Bring in a logbook** drawer: what the server offers, a field for another folder, what bringing
 * one in replaces, and, once the server has accepted one, waiting for it to come back with that
 * logbook.
 */
// @spec APP-UI-039, APP-UI-040
export function BringIn({ offer }: { offer: LogbookOffer | null }) {
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>(null);
  const gone = useRef(false);
  useEffect(
    () => () => {
      gone.current = true;
    },
    [],
  );

  const replaces = `${offer?.aircraft ?? 0} aircraft, no hops`;

  /** Ask the server every so often until it answers with another process id and its start-up done. */
  const waitForServer = async (before: number) => {
    const until = Date.now() + PAGE_TIMING.restartGiveUpMs;
    while (!gone.current) {
      await wait(PAGE_TIMING.restartPollMs);
      if (gone.current) return;
      if (Date.now() >= until) {
        setPhase("late");
        return;
      }
      try {
        const st = await api.status();
        if (st.pid !== before && st.startup === "done") {
          reloadPage();
          return;
        }
      } catch {
        // the old server exiting, or the new one not yet listening
      }
    }
  };

  const bringIn = async (name: string, body: { folder: string } | { backup: string }) => {
    if (!window.confirm(`Bring in ${name}? This replaces the logbook here (${replaces}).`)) return;
    setBusy(true);
    setError(null);
    try {
      const before = (await api.status()).pid;
      const r = await api.bringIn(body);
      setPhase(r.restart === "manual" ? "manual" : "bringing");
      if (r.restart === "automatic") void waitForServer(before);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  if (phase) {
    return (
      <div className="bring-in">
        <p>Bringing in the logbook…</p>
        {phase === "manual" && <p>Start the server again to finish bringing in the logbook.</p>}
        {phase === "late" && <p>Bringing in the logbook is taking longer than expected. Reload the page once MSFS Career Map is running again.</p>}
      </div>
    );
  }

  const last = offer?.lastAttempt;
  return (
    <div className="bring-in">
      <p className="muted small">This replaces the logbook here: {replaces}.</p>
      {last?.outcome === "not-brought-in" && <p className="caution">The last logbook was not brought in: {last.reason ?? "it could not be"}</p>}
      {offer?.offers.length ? (
        <ul className="offers">
          {offer.offers.map((o) => (
            <li key={o.kind === "folder" ? o.folder : o.file}>
              <div>
                <b className="code">{title(o)}</b>
                <div className="muted small">
                  {o.hops} hops{o.newestHop ? ` · newest ${fmtDate(o.newestHop)}` : ""}
                </div>
              </div>
              <button type="button" className="small primary" disabled={busy} onClick={() => void bringIn(askName(o), o.kind === "folder" ? { folder: o.folder } : { backup: o.file })}>
                Bring in
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">No other logbook found.</p>
      )}
      <div className="another">
        <label>
          <span>Another folder</span>
          <input type="text" value={folder} onChange={(e) => setFolder(e.target.value)} placeholder="C:\…\data" />
        </label>
        <button type="button" className="small" disabled={busy || folder.trim() === ""} onClick={() => void bringIn(folder.trim(), { folder: folder.trim() })}>
          Bring in
        </button>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
