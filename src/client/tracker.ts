import { useEffect, useRef, useState } from "react";
import type { Hop, TrackPoint, TrackerStatus } from "./types";

/** What the live tracker stream currently says. `online` is the event stream itself, not the sim. */
export interface LiveState {
  status: TrackerStatus | null;
  /** Points of the leg being flown right now (empty on the ground). */
  track: TrackPoint[];
  online: boolean;
}

/**
 * Subscribes to `/api/tracker/events`. The browser's EventSource reconnects by itself, and the
 * server re-sends the full status and track on every (re)connect, so nothing is lost in between.
 */
export function useTracker(onHop: (hop: Hop) => void): LiveState {
  const [status, setStatus] = useState<TrackerStatus | null>(null);
  const [track, setTrack] = useState<TrackPoint[]>([]);
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
    es.addEventListener("hop", (e) => hopCb.current(parse(e) as Hop));
    return () => es.close();
  }, []);

  return { status, track, online };
}

/** Parse a hop's stored track, tolerating old rows and bad JSON. */
export function parseTrack(json: string | null): TrackPoint[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as TrackPoint[]).filter((p) => Array.isArray(p) && p.length >= 2) : [];
  } catch {
    return [];
  }
}
