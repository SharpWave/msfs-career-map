import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { runwaySummary } from "../format";
import type { Airport } from "../types";

interface Props {
  id?: string;
  value: string;
  onChange: (code: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

/** Text box that accepts an ICAO/IATA/local code and offers search-as-you-type results. */
export function AirportInput({ id, value, onChange, placeholder, autoFocus }: Props) {
  const [text, setText] = useState(value);
  const [results, setResults] = useState<Airport[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [resolved, setResolved] = useState<Airport | null>(null);
  const [lookupFailed, setLookupFailed] = useState(false);
  const typing = useRef(false);

  // External value changes (form reset, defaults) replace the text unless the user is mid-edit.
  useEffect(() => {
    if (!typing.current) setText(value);
  }, [value]);

  // Resolve the committed code to a name for the hint line.
  useEffect(() => {
    let cancelled = false;
    if (!value || value.length < 2) {
      setResolved(null);
      setLookupFailed(false);
      return;
    }
    if (resolved && resolved.ident === value) return;
    api
      .getAirport(value)
      .then((a) => {
        if (cancelled) return;
        setResolved(a);
        setLookupFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setResolved(null);
        setLookupFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Debounced search while the dropdown is open.
  useEffect(() => {
    if (!open || text.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      api
        .searchAirports(text, 10)
        .then((r) => {
          setResults(r);
          setActive(0);
        })
        .catch(() => setResults([]));
    }, 120);
    return () => clearTimeout(t);
  }, [text, open]);

  const pick = (a: Airport) => {
    typing.current = false;
    setText(a.ident);
    setResolved(a);
    setLookupFailed(false);
    setOpen(false);
    onChange(a.ident);
  };

  const commit = () => {
    typing.current = false;
    const code = text.trim().toUpperCase();
    setText(code);
    if (code !== value) onChange(code);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) {
      if (e.key === "Enter") commit();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(results[active]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  let hint = " ";
  if (resolved) {
    const rwy = runwaySummary(resolved);
    hint = resolved.name + (resolved.municipality ? ` · ${resolved.municipality}` : "") + (rwy ? ` · ${rwy}` : "");
  } else if (lookupFailed && value) {
    hint = "Unknown airport code";
  }

  return (
    <div className="airport-input">
      <input
        id={id}
        className="code"
        value={text}
        placeholder={placeholder ?? "ICAO"}
        autoComplete="off"
        spellCheck={false}
        autoFocus={autoFocus}
        onChange={(e) => {
          typing.current = true;
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          commit();
        }}
        onKeyDown={onKeyDown}
      />
      {open && results.length > 0 && (
        <ul className="dropdown" role="listbox">
          {results.map((a, i) => (
            <li
              key={a.ident}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : ""}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(a)}
            >
              <b className="code">{a.ident}</b>
              <span className="name">{a.name}</span>
              <small>
                {[a.municipality, a.iso_country].filter(Boolean).join(", ")}
              </small>
            </li>
          ))}
        </ul>
      )}
      <div className={`hint${lookupFailed && value ? " bad" : ""}`}>{hint}</div>
    </div>
  );
}
