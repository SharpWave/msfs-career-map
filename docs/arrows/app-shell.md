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
- tests/app-shell/layout.test.ts — APP-UI-002, 009, 013, 014, 020
- tests/app-shell/menu.test.tsx — APP-UI-002, 012, 013, 016
- tests/app-shell/left-column.test.tsx — APP-UI-002, 013, 014, 015, 017, 018
- tests/app-shell/sidebar.test.tsx — APP-UI-001, 029
- tests/app-shell/page.test.tsx — APP-UI-001, 002, 012, 013, 014, 015, 016, 017, 018, 019, 020
- tests/app-shell/icons.test.tsx — APP-UI-026
- tests/tour-map/fit.test.ts — APP-UI-020
- tests/tour-map/map-toolbar.test.tsx — APP-UI-016
- tests/fleet/fleet-list.test.tsx — APP-UI-026
- tests/flight-panel/flight-panel.test.tsx — APP-UI-005
- tests/e2e/smoke.spec.ts — APP-RUN-012, 017, 018; APP-UI-001, 012
- tests/e2e/layout.spec.ts — APP-UI-006, 007, 009, 010, 011, 020, 021, 022, 023, 024, 025, 027, 028
- tests/e2e/global-setup.ts — APP-RUN-017 (the check itself)
- tests/support/page-data.ts, tests/e2e/seed.ts — data builders for the component and browser tests (no specs of their own)
- APP-RUN-003 is verified by `npm run typecheck`; APP-RUN-016 also by hand (a taken port fails the run in about a second)

### Code
- src/server/index.ts — startup
- src/server/app.ts — `createApp`
- src/server/locations.ts — data locations
- src/server/db.ts — pragmas, `addColumnIfMissing`
- src/server/routes.ts — helpers (28-62), `/status` (813-815), error handlers (818-828)
- src/client/api.ts — `req`
- src/client/App.tsx — the page's layout, hand-offs to the drawers (`openDrawer`), loading, error banner
- src/client/layout.ts — panel sizes, the clear part of the map (`clearInsets`), the left column's reducer
- src/client/prefs.ts — `readPref`, `writePref`, `prefersReducedMotion`
- src/client/components/Sidebar.tsx — the live and planner cards, collapsing
- src/client/components/Menu.tsx — menu button, count line, sidebar toggle
- src/client/components/Drawer.tsx — `LeftColumn` and the drawers
- src/client/components/useDismiss.ts — closing the menus on Esc and outside clicks
- src/client/components/Icon.tsx — icon set, `IconButton`
- src/client/components/MapView.tsx — `PopupPadding`
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
5. `App` / `Sidebar` / `Menu` / `LeftColumn` / `ErrorBoundary` — layout and contained failures
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
2. **The launcher never rebuilds after an update** — start.cmd builds only when `dist/` is missing.
3. **Implemented specs without tests** — APP-SRV-001, 003; APP-DATA-003; APP-API-006; APP-UI-002, 003, 004, 006, 008; APP-RUN-002, 004, 005, 007, 009, 010.

## Work Required

### Should Fix
1. Rebuild a stale build and refuse a server of another version in the launcher (APP-RUN-006,
   APP-RUN-008; start.cmd).
2. One version from `package.json` for `/api/status` and every User-Agent (APP-API-005).

### Nice to Have
3. Tests for the implemented specs listed in Key Findings 3.
