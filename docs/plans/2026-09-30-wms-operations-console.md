# Cherry WMS Operations Console Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task when subagents can access the repository. In this session use direct execution; worktree agents cannot start from the harness home directory. Do not commit without separate user authorization.

**Goal:** Implement the approved operations-console direction A while preserving every existing submenu, label, nesting level, route, hideInMenu flag, permission rule, and tab behavior.

**Architecture:** Keep React 19, TypeScript, Ant Design 5/ProComponents, ECharts, Tailwind 4, and the existing stores/request infrastructure. Refactor presentation in place, adding only a Dashboard-local request hook reused by its four widgets. Keep backend/API contracts unchanged and preserve the pre-existing uncommitted theme/layout/Dashboard work as the baseline.

**Tech Stack:** React 19, TypeScript 5.9, Vite 7, Ant Design 5, ProComponents 2, Tailwind CSS 4, ECharts 6. Browser checks use the locally installed puppeteer-core and Chrome.

---

## Approved design

The user approved direction A after requesting retention of all previous submenus. The visual companion's simplified sidebar was illustrative, not an approved navigation change. Preserve `router/routes.tsx` and `router/permissions.ts` byte-for-byte.

Palette: primary #E61B2B, hover #C41522, active #A2121C, danger foreground #B42318, canvas #F3F4F6, inset #F8FAFC, surface #FFFFFF. Keep remaining existing tokens, Inter, numeric/code utilities, original white-filtered logo, 12px panels, and 8px controls. No dark mode, replacement framework, decorative gradients, or new palette.

Replace the editorial Dashboard rail/hero with a compact heading, six-metric strip, real task category/count queue, aggregate capacity, throughput chart, and permission-aware shortcuts. Do not invent order-level tasks, warehouse/shift labels, live status, trend percentages, or notices. Explain that current metrics are grouped by order creation date, not event timestamps. Preserve the application's existing Chinese labels; new explanatory prose is English.

## Task 1: Capture baseline and executable checks

**Files:** Create `wms-frontend/scripts/verify-console.cjs`; artifacts under `.superpowers/console-qa/` (not committed).

- Start Vite: `npm --prefix "E:/Antigravity folder/cherry logistics platform/wms-frontend" run dev -- --host 127.0.0.1`.
- Run baseline: `npm --prefix "E:/Antigravity folder/cherry logistics platform/wms-frontend" run build`.
- Script intercepts API traffic with clearly synthetic fixtures and injects only a fake local UI session. Never let fixture credentials reach a real server.
- Capture baseline Dashboard, outbound list/detail, and packing screenshots. Snapshot route/permission file hashes.
- Add assertions for six metrics, genuine zero capacity, independent failure/retry, role-aware shortcuts, and absence of invented context. Run before implementation and observe failure.

## Task 2: Dashboard data states

**Files:** Create `src/pages/Dashboard/useDashboardResource.ts`; modify `src/pages/Dashboard/index.tsx`.

- Use the existing request envelope `{data}` for the four existing endpoints: stats, trend?days=7, warehouse-utilization, todos.
- A page-local hook owns loading, nullable data, error, success timestamp, and retry per resource; request generations prevent stale/unmounted updates.
- Preserve previously successful data during reload but show a failure banner if refresh fails. Never display failure as zero, empty, or healthy.
- Validate with one failed endpoint while other widgets succeed, then retry successfully; test successful empty arrays and all-zero utilization separately.

## Task 3: Dashboard operations layout

**Files:** Modify `src/pages/Dashboard/index.tsx`, `src/index.css`.

- Keep all six metric fields. Remove fabricated comparative percentages and notice fallback.
- Render real category/count tasks with existing allowed-route links. Unknown categories remain readable without invented links.
- Use aggregate occupied/reserved/empty capacity with exact zero preservation. No zone ranking.
- Render the existing seven-day arrays using solid brand/ink series with different line styles; no decorative fill.
- Add real shortcuts to receiving, putaway, outbound, packing, inventory, and quote pages, filtered by `canAccessPath`.
- Add scoped unlayered CSS (Ant Design/Tailwind cascade), responsive 6/3/2 KPI layout, compact header, low-elevation panels, numeric alignment, visible focus and reduced motion.
- Verify Dashboard contract tests and actual computed palette/overflow.

## Task 4: Shell and list/detail

**Files:** Modify `src/layouts/AppLayout.tsx`, `src/pages/Outbound/index.tsx`, `src/index.css`.

- Add a shell class and scoped visual refinements only. Keep menu data and navigation handlers unchanged.
- Make logout a semantic button without changing behavior.
- Outbound: opt-in console class, dense rows, internal horizontal scrolling, numeric alignment, semantic action colors, responsive detail width.
- Keep every detail field, create/import dialog, action, permission wrapper, and API request.
- Verify list/detail fixture screens and route/permission hashes.

## Task 5: Packing workstation

**Files:** Modify `src/pages/Outbound/Packing/index.tsx`, `src/index.css`.

- Scope workstation presentation, distinguish order selection / scan / progress, add accessible input names and live feedback, use readable code/numeric styling and internal table scrolling.
- Preserve all service calls, quantity/status handlers, and permissions. Do not silently repair unrelated pre-existing handler logic.
- Use already-PACKING synthetic order for UI tests; intercepted POST assertions never touch production inventory.

## Task 6: Verify and review

- Run the production build and browser contract suite.
- Capture matching after screenshots at 1440x900, 1920x1080, 1280x800, 768x1024, 390x844.
- Check page errors, palette, true-zero/failure states, shortcut permissions, list/detail fields, scan feedback, and unchanged navigation sources.
- Start backend only after checking startup scripts for writes. Any live smoke is read-only. Label fixture tests separately from real-backend tests.
- Review `git diff --check` and scoped diff. No commits, pushes, migrations, resets, schema changes, customer data exports, or production data writes.

## Deferred rollout

This first batch does not claim page-level redesign of inbound, inventory, transit, product, customer, exceptions, audit, dictionaries, rate cards, or billing. Their existing submenu entries and business UIs remain. Shared shell styling may affect them, but that is not completed page-level verification.

## Execution note

The tool harness initially blocked shell/file writes because its safety-classifier service was unavailable. Execution recovered after the user's subsequent proceed instruction. Local apps were not running; baseline checks start now. Do not claim any check passed until its output is observed.
