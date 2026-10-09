# Arrow: app-shell

What holds the app together: server startup and serving, data locations and schema upgrades, API
conventions, the page layout and its failure handling, shared formatting, and the npm scripts,
launcher and desktop shortcut.

## Status

**MAPPED** — mapped 2026-10-09 from `b408604`; not yet audited. Brownfield skeleton: the LLD
describes current behaviour with partly inferred rationale; specs drafted, no tests yet.

## References

### HLD
- docs/high-level-design.md (System Design → app-shell)

### LLD
- docs/intent/app-shell/app-shell-design.md

### EARS
- docs/intent/app-shell/app-shell-specs.md (35 specs)

### Tests
- none (the project has no test suite yet)

### Code
- src/server/index.ts
- src/server/db.ts — paths, pragmas, `addColumnIfMissing`
- src/server/routes.ts — helpers (28-62), `/status` (813-815), error handlers (818-828)
- src/client/api.ts — `req`
- src/client/App.tsx — layout, sidebar toggle, loading, error banner
- src/client/components/Sidebar.tsx — header, card order
- src/client/components/ErrorBoundary.tsx
- src/client/format.ts — shared formatters
- src/client/styles.css, src/client/index.html, src/client/main.tsx
- package.json, vite.config.ts, tsconfig.json, tsconfig.server.json
- start.cmd, scripts/install-shortcut.ps1, scripts/make-ico.mjs

## Architecture

**Purpose:** Run the app as one local server and one page, keep its data in one file, and make it
start with a double-click.

**Key Components:**
1. `main` (`index.ts`) — reference data, tracking, Express, static serving
2. `db.ts` — data paths, SQLite with WAL and foreign keys, in-place upgrades
3. API helpers and error handlers; client `req`
4. `App` / `Sidebar` / `ErrorBoundary` — layout and contained failures
5. `start.cmd`, shortcut and icon scripts

## Spec Coverage

| Category | Spec IDs | Implemented | Deferred | Gaps |
|----------|----------|-------------|----------|------|
| Server | APP-SRV-001 to 003 | 3 | 0 | 0 |
| Data and database | APP-DATA-001 to 003 | 2 | 0 | 1 |
| API conventions | APP-API-001 to 006 | 5 | 0 | 1 |
| Page layout and failures | APP-UI-001 to 008 | 7 | 0 | 1 |
| Shared formatting | APP-FMT-001 to 003 | 3 | 0 | 0 |
| Scripts and launcher | APP-RUN-001 to 012 | 8 | 0 | 4 |

**Summary:** 28 of 35 specs implemented; 7 gaps; none deferred. No spec has a test.

## Key Findings

1. **A test database copy overwrites the real icons** — images ignore `CAREER_DB` (db.ts:9).
2. **The version is in five places, disagreeing** — "0.8.0" in `/api/status`, "0.6" in four User-Agents.
3. **The planner's cruise-altitude warning is unstyled** — `.hint` is scoped to `.airport-input` (styles.css:307-320).
4. **The launcher never rebuilds after an update** — start.cmd builds only when `dist/` is missing.
5. **No test suite.**

## Work Required

### Must Fix
1. Add the test commands first, since every other gap is closed test-first (APP-RUN-011, APP-RUN-012).

### Should Fix
2. Keep icons beside the database in use (APP-DATA-002; db.ts:9).
3. Rebuild a stale build and refuse a server of another version in the launcher (APP-RUN-006,
   APP-RUN-008; start.cmd).
4. One version from `package.json` for `/api/status` and every User-Agent (APP-API-005).

### Nice to Have
5. One hint style for every form (APP-UI-007; styles.css:307-320).
