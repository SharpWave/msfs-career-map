import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMap } from "react-leaflet";
import { copiesInView, type Copies } from "../paths";

interface WorldCopiesValue {
  /** The world copies in view. */
  copies: Copies;
  /** Add copies to those in view until the map next comes to rest — where a zoom is about to land. */
  include: (more: Copies) => void;
}

const Context = createContext<WorldCopiesValue>({ copies: { lo: 0, hi: 0 }, include: () => {} });

/** The world copies in view, for drawing each layer on every one of them (MAP-GEO-014). */
export const useWorldCopies = () => useContext(Context);

const same = (a: Copies, b: Copies) => a.lo === b.lo && a.hi === b.hi;

/**
 * Keeps track of the world copies in view: worked out again whenever the map comes to rest after a
 * pan, zoom or resize — which is when Leaflet redraws its vector layers too — and widened ahead of
 * a zoom to where it will land. The set only changes when a copy comes into or leaves view, so a
 * layer keyed by copy keeps what is drawn on copies that stay, popups and tooltips included.
 */
// @spec MAP-GEO-017, MAP-GEO-018, MAP-GEO-019
export function WorldCopies({ children }: { children: ReactNode }) {
  const map = useMap();
  const inView = useCallback(() => {
    const b = map.getBounds();
    return copiesInView(b.getWest(), b.getEast());
  }, [map]);
  const [copies, setCopies] = useState<Copies>(inView);

  useEffect(() => {
    const atRest = () => {
      const next = inView();
      setCopies((cur) => (same(cur, next) ? cur : next));
    };
    map.on("moveend", atRest);
    return () => {
      map.off("moveend", atRest);
    };
  }, [map, inView]);

  const include = useCallback((more: Copies) => {
    setCopies((cur) => {
      const next = { lo: Math.min(cur.lo, more.lo), hi: Math.max(cur.hi, more.hi) };
      return same(cur, next) ? cur : next;
    });
  }, []);

  const value = useMemo(() => ({ copies, include }), [copies, include]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
