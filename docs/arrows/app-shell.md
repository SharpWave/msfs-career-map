# Arrow: app-shell

What holds the app together: server startup and serving, data locations and schema upgrades, API
conventions, the page layout and its failure handling, shared formatting, the npm scripts,
launcher and desktop shortcut, and the test harness behind `npm test` and `npm run test:e2e`.

## Status

**MAPPED** — mapped 2026-10-09 from `b408604`; not yet audited. Brownfield skeleton: the LLD
describes current behaviour with partly inferred rationale. The test harness is in place and
covers the specs listed under Tests.

## References

### HLD
- docs/high-level-design.md (System Design → app-shell; Key Design Decisions → Testing)

### LLD
- docs/intent/app-shell/app-shell-design.md

### EARS
- docs/intent/app-shell/app-shell-specs.md (42 specs)

### Tests
- tests/app-shell/harness.test.ts — APP-RUN-001, 011, 012, 013, 014, 015, 016; APP-DATA-001, 002
- tests/app-shell/api.test.ts — APP-SRV-002, 004; APP-API-001, 002, 003, 004; APP-DATA-002; APP-RUN-011
- tests/app-shell/format.test.ts — APP-FMT-001, 002, 003
- tests/app-shell/error-boundary.test.tsx — APP-UI-005
- tests/app-shell/fetch-guard.test.tsx — APP-RUN-011, 014
- tests/e2e/smoke.spec.ts — APP-RUN-012, 017, 018; APP-UI-001
- tests/e2e/global-setup.ts — APP-RUN-017 (the check itself)
- APP-RUN-003 is verified by `npm run typecheck`; APP-RUN-016 also by hand (a taken port fails the run in about a second)

### Code
- src/server/index.ts — startup
- src/server/app.ts — `createApp`
- src/server/locations.ts — data locations
- src/server/db.ts — pragmas, `addColumnIfMissing`
- src/server/routes.ts — helpers (28-62), `/status` (813-815), error handlers (818-828)
- src/client/api.ts — `req`
- src/client/App.tsx — layout, sidebar toggle, loading, error banner
- src/client/components/Sidebar.tsx — header, card order
- src/client/components/ErrorBoundary.tsx
- src/client/format.ts — shared formatters
- src/client/styles.css, src/client/index.html, src/client/main.tsx
- package.json, vite.config.ts, tsconfig.json, tsconfig.server.json, tsconfig.test.json
- vitest.config.ts, playwright.config.ts, tests/support/
- start.cmd, scripts/install-shortcut.ps1, scripts/make-ico.mjs

## Architecture

**Purpose:** Run the app as one local server and one page, keep its data in one folder, make it
start with a double-click, and test it without touching the real logbook or the internet.

**Key Components:**
1. `main` (`index.ts`) — reference data, tracking, listening
2. `createApp` (`app.ts`) — API, icons, page
3. `dataLocations` / `db.ts` — data folder, SQLite with WAL and foreign keys, in-place upgrades
4. API helpers and error handlers; client `req`
5. `App` / `Sidebar` / `ErrorBoundary` — layout and contained failures
6. `start.cmd`, shortcut and icon scripts
7. Test harness — per-file data folders, fetch guard, browser-test servers

## Spec Coverage

| Category | Spec IDs | Implemented | Deferred | Gaps |
|----------|----------|-------------|----------|------|
| Server | APP-SRV-001 to 004 | 4 | 0 | 0 |
| Data and database | APP-DATA-001 to 003 | 3 | 0 | 0 |
| API conventions | APP-API-001 to 006 | 5 | 0 | 1 |
| Page layout and failures | APP-UI-001 to 008 | 7 | 0 | 1 |
| Shared formatting | APP-FMT-001 to 003 | 3 | 0 | 0 |
| Scripts, launcher and tests | APP-RUN-001 to 018 | 16 | 0 | 2 |

**Summary:** 38 of 42 specs implemented; 4 gaps; none deferred. 22 specs have tests (one more,
APP-RUN-003, is checked by `npm run typecheck`).

## Key Findings

1. **The version is in five places, disagreeing** — "0.8.0" in `/api/status`, "0.6" in four User-Agents.
2. **The planner's cruise-altitude warning is unstyled** — `.hint` is scoped to `.airport-input` (styles.css:307-320).
3. **The launcher never rebuilds after an update** — start.cmd builds only when `dist/` is missing.
4. **Implemented specs without tests** — APP-SRV-001, 003; APP-DATA-003; APP-API-006; APP-UI-002, 003, 004, 006, 008; APP-RUN-002, 004, 005, 007, 009, 010.

## Work Required

### Should Fix
1. Rebuild a stale build and refuse a server of another version in the launcher (APP-RUN-006,
   APP-RUN-008; start.cmd).
2. One version from `package.json` for `/api/status` and every User-Agent (APP-API-005).

### Nice to Have
3. One hint style for every form (APP-UI-007; styles.css:307-320).
4. Tests for the implemented specs listed in Key Findings 4.
