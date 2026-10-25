import { useEffect, useRef, useState } from "react";
import type { Hop, HopEvent, TrackPoint, TrackerStatus } from "./types";

/** What the live tracker stream currently says. `online` is the event stream itself, not the sim. */
export interface LiveState {
  status: TrackerStatus | null;
  /** Points of the leg being flown right now (empty on the ground). */
  track: TrackPoint[];
  /** The casual path's segments (empty while casual mode is off). */
  path: TrackPoint[][];
  online: boolean;
}

/** How long the page waits after the stream ends before it opens it again. */
const REOPEN_MS = 3000;

/**
 * Subscribes to `/api/tracker/events`. When the stream ends (the server stopped, or answered
 * "starting" while it comes up), the page closes it and opens a new one 3 s later, one at a time;
 * the server re-sends the full status, track and casual path on every connect, so nothing is lost
 * in between. A `hop` event carries the hop and the tracker's message for it; `onHop` gets the hop.
 */
// @spec LIVE-API-005, LIVE-API-011, LIVE-API-014
export function useTracker(onHop: (hop: Hop) => void): LiveState {
  const [status, setStatus] = useState<TrackerStatus | null>(null);
  const [track, setTrack] = useState<TrackPoint[]>([]);
  const [path, setPath] = useState<TrackPoint[][]>([]);
  const [online, setOnline] = useState(false);
  const hopCb = useRef(onHop);
  hopCb.current = onHop;

  useEffect(() => {
    let es: EventSource | null = null;
    let reopen: ReturnType<typeof setTimeout> | null = null;
    const parse = (e: Event) => JSON.parse((e as MessageEvent<string>).data);

    const open = () => {
      reopen = null;
      const src = new EventSource("/api/tracker/events");
      es = src;
      src.onopen = () => setOnline(true);
      src.onerror = () => {
        setOnline(false);
        src.close();
        if (es !== src) return;
        es = null;
        reopen = setTimeout(open, REOPEN_MS);
      };
      src.addEventListener("status", (e) => setStatus(parse(e) as TrackerStatus));
      src.addEventListener("track", (e) => setTrack(parse(e) as TrackPoint[]));
      src.addEventListener("point", (e) => {
        const p = parse(e) as TrackPoint;
        setTrack((t) => [...t, p]);
      });
      src.addEventListener("path", (e) => setPath(parse(e) as TrackPoint[][]));
      // Only the last segment is replaced, so the earlier ones keep their identity (and their placing).
      src.addEventListener("path-point", (e) => {
        const p = parse(e) as TrackPoint;
        setPath((path) => (path.length ? [...path.slice(0, -1), [...path[path.length - 1], p]] : [[p]]));
      });
      src.addEventListener("hop", (e) => hopCb.current((parse(e) as HopEvent).hop));
    };

    open();
    return () => {
      if (reopen) clearTimeout(reopen);
      reopen = null;
      es?.close();
      es = null;
    };
  }, []);

  return { status, track, path, online };
}

/** Parse a hop's stored track, tolerating old rows and bad JSON. */
export function parseTrack(json: string | null): TrackPoint[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as TrackPoint[]).filter((p) => Array.isArray(p) && p.length >= 4) : [];
  } catch {
    return [];
  }
}
