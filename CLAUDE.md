# MSFS Career Map — project notes

Map-centric logbook for a home-spun MSFS 2024 career mode. See README.md for the user-facing
description, API table and roadmap.

## Stack

- Node 22+ with the built-in `node:sqlite` (no native modules). Server is Express 4 in TypeScript run
  via `tsx`; schema lives in `src/server/db.ts`.
- Client is Vite + React 18 + react-leaflet 4. Vite root is `src/client`, build output is `dist/`,
  which the server serves when present.
- Airport and runway data are the OurAirports CSVs, imported into `airports` / `runways` on first
  run. `airport_rwy` is a per-airport summary (longest runway, surfaces, paved/lit flags) rebuilt by
  every runway import; airport queries LEFT JOIN it. Surface free-text is normalised by
  `surfaceClass()` in `src/server/airports.ts`.
- Schema changes to existing tables go through `addColumnIfMissing()` in `src/server/db.ts` so
  older databases upgrade in place.
- Live tracking: `src/server/simconnect.ts` wraps node-simconnect (pure TypeScript, no SDK DLL)
  and only produces position samples and system events; `src/server/tracker.ts` is the
  sim-independent state machine (`feed(sample)`), checkpointed to the `tracker_state` row so a
  leg survives a server restart. The client subscribes to `/api/tracker/events` (SSE).
- Landing rating thresholds (`rateLanding`) live in `src/server/tracker.ts`; the client only
  maps a rating to icon/word/color in `src/client/landing.ts`. The per-frame touchdown watcher
  is in `simconnect.ts`; the tracker makes a provisional landing from 1 Hz data and replaces it
  when the frame-accurate one arrives within 6 s.
- SimBrief: `src/server/ofp.ts` fetches `xml.fetcher.php?...&json=v2` by alias or pilot ID (the
  only setting, in the `settings` table) and parses both the v2 and the older all-strings shape.
  Briefings are archived whole (raw JSON + OFP HTML + summary) in `briefings`, linked from
  `hops.briefing_id`. The tracker holds one "current" briefing that the next logged hop consumes.
- Charts follow the dataviz skill: no dual axes; the profile chart indexes each series to its own
  range and shows real values in the legend and crosshair. Palette validated for the dark surface.

## Commands

- `npm run dev` — server on :3080 (tsx watch) + Vite on :5173 with `/api` proxied.
- `npm run build` then `npm start` — production-style single server on :3080.
- `npm run typecheck` — both client and server tsconfigs.
- `npm run import-airports [-- --fresh]` — re-import (optionally re-download) airports.
- `npm run sim-probe` — print what a running sim reports, without touching the database.
- `TRACKER_FAKE=1 npm run dev` then `npm run sim-fake -- KBOS KPVD [--touch-and-go]
  [--start-airborne] [--fpm 320 --g 2.1]` — drive the tracker with a synthetic flight; test
  against a copy of the database (`CAREER_DB=...`) so fake hops never land in the real logbook.
  Copy `career.db` with `-wal`/`-shm` or after a checkpoint, or recent rows are missing.

## Conventions

- Hops are ordered per aircraft by `seq`; the server renumbers after deletes/reorders.
- Airport codes are resolved server-side to the canonical OurAirports `ident` before storage.
- Timestamps are stored as ISO UTC strings; the client converts to/from `datetime-local`.
- `hops.track` is a JSON array of `[lat, lon, alt_ft, unix_seconds, gs_kts, vs_fpm, ias_kts,
  fuel_lb]` (0.7 rows have four fields), written only by the tracker (one sample per 5 s).
  `parseTrack()` in `src/client/tracker.ts` reads it and `paths.ts` draws it in place of the
  great circle, with the airport positions prepended/appended. `hops.landings` and `hops.stats`
  are JSON too (`Landing[]`, `HopStats`); readers must tolerate null for hand-logged hops.
- Aircraft rows carry `sim_title` / `sim_livery` (the sim's `TITLE` and `LIVERY NAME`); the
  tracker matches on both, with a blank `sim_livery` meaning any livery.
- Map geometry (great circles, antimeridian unwrapping, parked-aircraft positions) is computed in
  `src/client/paths.ts` and shared by the map and the zoom-to-fit logic. Keep those in sync.
- Writing files with bash heredocs failed in this environment; use the Write tool for new files.

## LID
- Mode: Full
- Version: 1.3.0

## Linked-Intent Development (MANDATORY)

**Consult the `linked-intent-dev` skill for ALL code changes.** All changes flow through the arrow of intent in one direction:

```
HLD → LLDs → EARS → Tests → Code
```

- **New features and refactors**: full six-phase workflow (HLD check → LLD check/draft → EARS → intent-narrowing edge audit → tests-first → code).
- **Bug fixes**: walk the arrow like any other change — find where behavior diverged from intent and cascade from there. No short-circuit.
- **If unsure**: use the full workflow.

Stop after each phase for user review. **Docs carry current intent, written to be read cold** — write each doc as if authored fresh today, from current intent alone: no narration of how it changed, no meaning that needs the conversation that produced it, no rebuttals to questions only a past discussion raised. Rationale, considered alternatives, and constraints a fresh author would independently write stay; record rejected alternatives and why in the LLD's Decisions & Alternatives table, not as asides in body prose.

**Memory vs. intent.** Before saving durable project knowledge to agent or tool memory, test whether it is project *intent* — would a fresh agent, in any tool, next session, need it to build this system correctly? If yes, record it in the arrow (HLD / LLD / EARS / decision doc), which travels and cascades — not in private, per-tool memory, where intent escapes the arrow. Knowledge about the user or how they like to work stays in memory.

### Navigation

| What you need | Where to look |
|---|---|
| High-level design | `docs/high-level-design.md` |
| Design tree (sub-HLDs, LLDs, their specs) | `docs/intent/` — one folder per node |
| EARS specs | beside each design doc as `{node}-specs.md` in the node's folder under `docs/intent/` |
| Decision docs | `docs/decisions/` (project-level) and `docs/intent/<segment>/decisions/` |
| Arrow of intent overlay | `docs/arrows/index.yaml` and per-segment docs in `docs/arrows/` |

### Terminology

- **HLD**: High-Level Design — single project-level doc at `docs/high-level-design.md`.
- **LLD**: Low-Level Design — detailed component design doc in `docs/intent/`. The design layer is a recursive tree: the root is the HLD, leaf LLDs own EARS, and a component deep enough to outgrow one doc becomes a sub-HLD (HLD-shaped, owns no EARS) with children beneath it. "HLD" and "LLD" are roles by position; depth-2 (one HLD over flat leaf LLDs) is the default.
- **EARS**: Easy Approach to Requirements Syntax — structured one-line requirements beside each design doc as `{node}-specs.md` in the node's folder under `docs/intent/`. IDs are path-concatenated — the root-to-leaf path of the owning segment plus a number — so a prefix grep gathers a subtree. Markers: `[x]` implemented, `[ ]` active gap, `[D]` deferred.
- **Arrow**: the unidirectional chain from vision to code (HLD → LLDs → EARS → Tests → Code). Strictly a DAG of intent.
- **Arrow segment**: the territory owned by one leaf LLD — the LLD itself plus the specs, tests, and code that cite its EARS IDs. The boundary is the leaf prefix. Within-segment cascade is free; across-segment cascade pauses.
- **Cascade**: propagating a change downstream through the arrow so adjacent levels stay coherent.

### Code annotations

Annotate code and tests with `@spec` comments citing EARS IDs:

```
// @spec AUTH-UI-001, AUTH-UI-002
```

Place the annotation at the *entry point of the behavior's implementation graph* — the topmost function or module owning the specified behavior, not every helper. When a behavior spans multiple subsystems (UI + API + database, for example), annotate at the entry point in each subsystem. Tests follow the same rule: annotate the test that directly exercises the spec, not every inner assertion.
