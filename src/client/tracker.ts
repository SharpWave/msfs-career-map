import { useEffect, useRef, useState } from "react";
import type { Hop, TrackPoint, TrackerStatus } from "./types";

/** What the live tracker stream currently says. `online` is the event stream itself, not the sim. */
export interface LiveState {
  status: TrackerStatus | null;
  /** Points of the leg being flown right now (empty on the ground). */
  track: TrackPoint[];
  /** The casual path's segments (empty while casual mode is off). */
  path: TrackPoint[][];
  online: boolean;
}

/**
 * Subscribes to `/api/tracker/events`. The browser's EventSource reconnects by itself, and the
 * server re-sends the full status, track and casual path on every (re)connect, so nothing is lost
 * in between.
 */
// @spec LIVE-API-005, LIVE-API-011
export function useTracker(onHop: (hop: Hop) => void): LiveState {
  const [status, setStatus] = useState<TrackerStatus | null>(null);
  const [track, setTrack] = useState<TrackPoint[]>([]);
  const [path, setPath] = useState<TrackPoint[][]>([]);
  const [online, setOnline] = useState(false);
  const hopCb = useRef(onHop);
  hopCb.current = onHop;

  useEffect(() => {
    const es = new EventSource("/api/tracker/events");
    const parse = (e: Event) => JSON.parse((e as MessageEvent<string>).data);
    es.onopen = () => setOnline(true);
    es.onerror = () => setOnline(false);
    es.addEventListener("status", (e) => setStatus(parse(e) as TrackerStatus));
    es.addEventListener("track", (e) => setTrack(parse(e) as TrackPoint[]));
    es.addEventListener("point", (e) => {
      const p = parse(e) as TrackPoint;
      setTrack((t) => [...t, p]);
    });
    es.addEventListener("path", (e) => setPath(parse(e) as TrackPoint[][]));
    // Only the last segment is replaced, so the earlier ones keep their identity (and their placing).
    es.addEventListener("path-point", (e) => {
      const p = parse(e) as TrackPoint;
      setPath((path) => (path.length ? [...path.slice(0, -1), [...path[path.length - 1], p]] : [[p]]));
    });
    es.addEventListener("hop", (e) => hopCb.current(parse(e) as Hop));
    return () => es.close();
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
