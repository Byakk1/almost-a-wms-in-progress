# Pilot-critical path — dropship outbound through the UI (design)

> 2026-11-06 · Phase 4 · precedes E6 (deploy). Decisions locked with the user in brainstorming:
> D2 = this Windows box · D3 = dropship outbound first · capture = weight at pack, tracking at ship ·
> exception resolve = retry or cancel · crew = three roles (RBAC unchanged).

## 1. Problem

A static UI→API audit (2026-11-06) showed a real operator cannot run one dropship order end to end
through the UI. Backend E2E suites pass only because they call services directly.

| # | Blocker | Evidence |
|---|---|---|
| B1 | No UI calls `POST /outbound-orders/:id/pick`; `completePicking` requires `pickedQty >= requiredQty` → every UI order sticks in PICKING | `outbound-orders.service.ts:387` |
| B2 | No UI calls `POST /receiving-orders` → stock cannot enter via the UI | `receiving-orders.controller.ts:27` |
| B3 | Packing/ship capture no weight → UI-created orders bill as `出库单缺少重量` | `bills.service.ts:519` |
| B4 | `trackingNo` only settable at order create; `ship()` takes no body; sign-out matches on `trackingNo` | `outbound-orders.controller.ts:113`, `Outbound/Signout/index.tsx:97` |
| B5 | No code path EXCEPTION→PENDING and no UI caller of exception resolve → one mis-click leaves cancel as the only exit | `outbound-orders.service.ts:710` |

## 2. Goal and success criteria

Done when a browser run against the real backend, using three real non-SUPER_ADMIN users, completes:

1. CUSTOMER_SERVICE creates an inbound order and an outbound order (no weight, no tracking) in the UI.
2. OPERATOR: arrive → scan receive → complete → putaway → allocate → pick (workbench) → pack with
   weight → ship with carrier + tracking.
3. WAREHOUSE_ADMIN signs the order out by scanning its tracking number.
4. A bill generated for the test customer prices the shipped order (no `缺少重量` line).
5. Exception paths: RETRY returns an order to PENDING and it re-allocates; OPERATOR has no cancel
   option (API returns 403); WAREHOUSE_ADMIN cancel works.
6. Zero `pageerror`s; DB back to pre-run baseline afterwards.

Non-goals: label printing / carrier API integration, PDA app, wave creation UI, multi-box packing
(`Box` records for dropship), `Outbound/Shipment` mock cleanup, RBAC changes, any DDL.

## 3. Approach

Extend existing endpoints with request bodies and add one workbench page modelled on the existing
Packing and Receiving scan pages. Rejected: a combined pick/pack/ship workstation (rewrites the
working Packing page); list-row modals only (poor for scanner-gun picking, loses the queue view).

**No schema change.** Every column used already exists: `packageActualWeight`, `packageLength/Width/Height`,
`carrier`, `trackingNo`, `shippedAt`, `pickedQty`, `packedQty`, `Product.barcode`, `Location.code`.

## 4. Backend changes

All changes are in `wms-backend/src/outbound-orders/` unless stated; every state change writes an
`opLog` row inside its transaction, matching existing actions. Role decorators are unchanged except
where noted.

### 4.1 Order detail returns pick locations and barcode
`GET /outbound-orders/:id` — each item additionally returns
`barcode` and `allocations: [{ locationCode, batchNo, qty }]` (via `allocations → inventory → location`).
Additive fields only; existing consumers unaffected.

### 4.2 Complete packing requires weight
`POST /outbound-orders/:id/complete-packing` body `CompletePackingDto`:

| Field | Rule |
|---|---|
| `actualWeightKg` | required, number > 0, ≤ 3 decimals |
| `lengthCm`, `widthCm`, `heightCm` | optional, number > 0, ≤ 1 decimal; **all three or none** (400 otherwise) |

Writes `packageActualWeight` and, when given, `packageLength/Width/Height`. `packageBillingWeight`
stays NULL so billing's existing `max(actual, volumetric)` rule (`bills.service.ts:693`) applies.

### 4.3 Ship requires carrier and tracking
`POST /outbound-orders/:id/ship` body `ShipOutboundDto { carrier?: string; trackingNo?: string }`
(both trimmed; empty string = not supplied).

- Effective value = body value if supplied, else the stored value.
- If effective `carrier` or effective `trackingNo` is missing → 400 (`缺少承运商` / `缺少跟踪号`), no state change.
- A **body-supplied** carrier must exactly equal a name from §4.4, else 400. Stored carriers from
  import are not re-validated (they may be legitimate legacy values).
- Writes `carrier`, `trackingNo`, `status=SHIPPED`, `shippedAt`, plus the existing stock decrement.
  Audit row's `afterData` includes carrier and trackingNo.

### 4.4 Carrier list (names only)
`GET /outbound-orders/carriers` → `string[]`: distinct non-null `carrier` of rate cards with
`type='SHIPPING'` and `status='ACTIVE'`, sorted. Roles: SUPER_ADMIN, WAREHOUSE_ADMIN, OPERATOR,
CUSTOMER_SERVICE. Returns **names only** — no ids, prices, zones or customer assignments
(rate-card data is finance-only and must never leak). Route declared before `outbound-orders/:id`
so it is not captured as an id.

### 4.5 Exception resolve: RETRY or CANCEL
`POST /outbound-exceptions/:id/resolve` body
`ResolveExceptionDto { action: 'RETRY' | 'CANCEL'; resolution?: string (≤ 500) }` — `action` now required.
Roles on the route unchanged (SUPER_ADMIN, WAREHOUSE_ADMIN, OPERATOR); CANCEL additionally checks
the caller's role in the service: non-admin → 403.

One transaction:

| Exception status | Order status | RETRY | CANCEL |
|---|---|---|---|
| OPEN | EXCEPTION | exception→RESOLVED; order→PENDING; every item `pickedQty=0`, `packedQty=0`; clear `packageActualWeight/Length/Width/Height/BillingWeight`; keep carrier/trackingNo | exception→RESOLVED; order→CANCELLED |
| OPEN | CANCELLED (cancelled from list) | 400 `订单已取消，无法重试` | exception→RESOLVED only |
| OPEN | anything else | 400 (order no longer in EXCEPTION) | 400 |
| not OPEN | — | 400 (existing behaviour) | 400 |

Stock: reservations were already released when the exception was raised (`markException` →
`releaseAllocations`), so neither action touches inventory. RETRY uses
`assertTransition(..., 'PENDING')`; CANCEL uses `'CANCELLED'` — both already legal from EXCEPTION.
Audit rows record `action` and `resolution` on both the exception and the order.

### 4.6 Existing callers whose signatures change
Service methods gain a required argument, so these suites must pass valid bodies (assertions unchanged
except where noted):

| Caller | Change |
|---|---|
| `scripts/e2e-verify-picking.ts:146-147` | `completePacking(id, {actualWeightKg})`, `ship(id, {carrier, trackingNo})` |
| `scripts/e2e-verify-picking.ts:165` | `resolveException(id, {action:'RETRY', ...})`; assert order now PENDING with counts reset |
| `scripts/e2e-verify-fifo.ts:114,148` | same as picking |
| `scripts/e2e-verify-billing.ts:153` | `ship(id, {...})` without overriding the fixture's stored carrier (body omits `carrier`) |

Suites that ship with a body-supplied carrier need a tagged ACTIVE SHIPPING rate card fixture, or must
rely on the stored carrier (preferred: rely on stored, so no new fixture in old suites).

## 5. Frontend changes (`wms-frontend/src`)

### 5.1 Picking workbench (new) — `pages/Outbound/PickWorkbench/index.tsx`
Route `/outbound/pick-workbench` (`拣货操作台`, `hideInMenu`, like the packing workbench); route
permission OPS.

- **Queue**: orders in ALLOCATED, WAVE_ASSIGNED, PICKING (three list calls, merged, like Packing).
  Opening a non-PICKING order calls `start-picking` first, then loads detail.
- **Item table**: SKU, name, bins (`locationCode × qty`, batch if present), required, picked.
- **Scan input** (autofocus, Enter): match SKU or `barcode` against the order's items client-side
  (same rule as `Inbound/Receiving`); on hit `POST /pick {sku, qty: 1}`; display the server's
  `pickedQty`. Unknown code / over-pick → red status line, server message via interceptor.
- **完成拣货** enabled when every item `pickedQty >= requiredQty` → `complete-picking`, back to queue.
- **Entry points**: `去拣货` link on ALLOCATED / WAVE_ASSIGNED / PICKING rows of the outbound list
  (replaces those rows' `开始拣货`/`完成拣货` popconfirms, which cannot succeed without picking);
  dashboard shortcut.

### 5.2 Packing — weight modal
`pages/Outbound/Packing`: `完成打包` opens a Form modal (weight kg required; L/W/H cm optional,
client-side all-or-none rule mirroring §4.2) → `complete-packing` with the body. The outbound list's
`完成打包` popconfirm becomes `去打包` (navigate), since completing without weight is now rejected.

### 5.3 Ship modal
Outbound list `签出发货` opens a modal: carrier `Select` (options from §4.4; current value shown even
if not in list), tracking `Input`; both prefilled from the order; both required in the form → `ship`.

### 5.4 Exception resolve
`pages/Outbound/Exception`: OPEN rows get `处理` → modal with radio `重试（退回待分配）` /
`取消订单`, optional note → `resolve`. `取消订单` rendered only when the user has
`outbound.cancel` (ADMIN). The list's `EXCEPTION` row action keeps `取消` for admins and gains
`处理` linking to the exception page.

### 5.5 Inbound creation
`pages/Inbound` list: `新建收货单` button (permission `receiving.create`) → modal: customer,
warehouse, inbound tracking no., `Form.List` of product + expected qty (≥ 1 row). Products filtered
to the selected customer. `expectedQuantity` = sum of rows, computed client-side and sent. Option
sources reuse the outbound create form's calls (`/customers`, `/warehouses`, `/products`).

### 5.6 Permissions (`router/permissions.ts`)
Add route `/outbound/pick-workbench: OPS`; actions `outbound.pick: OPS`,
`outbound.ship: OPS`, `outbound.cancel: ADMIN`, `outbound.exceptionResolve: OPS`,
`receiving.create: ['SUPER_ADMIN','WAREHOUSE_ADMIN','CUSTOMER_SERVICE']` — each annotated with its
backing endpoint like existing entries. UX mirror only; backend `@Roles` remain the boundary.

### 5.7 UI conventions
antd declarative `<Modal>` (static `Modal.confirm` renders nothing under React 19 — known E4 bug);
numeric inputs via `InputNumber`; errors surfaced by the existing `request.ts` interceptor.

## 6. Testing and verification

### 6.1 Backend — `scripts/e2e-verify-pilot-path.ts` (new, service-level like existing suites)
Detail locations/barcode · complete-packing: missing weight / weight ≤ 0 / partial dims → 400, valid
→ columns written · ship: missing tracking / missing carrier / unknown body carrier → 400 with no
state change; body override persists; stored-only values accepted · carriers: only ACTIVE SHIPPING,
deduped, response contains no numeric/price fields · resolve: RETRY resets counts + package fields
and order→PENDING then re-allocates; CANCEL by OPERATOR → 403; CANCEL by admin → CANCELLED;
cancelled-order RETRY → 400, CANCEL → exception closed; non-OPEN → 400; audit rows present.
Plus: the callers updated per §4.6; all existing `e2e-verify-*` suites; backend `tsc`; frontend build.

### 6.2 Browser — `wms-frontend/scripts/verify-pilot-flow.cjs`
puppeteer-core + system Chrome against `127.0.0.1:5173` / `:3001`. Setup via API as SUPER_ADMIN
(password from `WMS_ADMIN_PASSWORD` env, never written to any file): three tagged users
(CUSTOMER_SERVICE, OPERATOR, WAREHOUSE_ADMIN) via `POST /users`; tagged customer, product (with
barcode), location; a tagged SHIPPING rate card with **synthetic prices**, assigned to the customer
and activated. Then drives §2 steps 1–5 through the UI as each user, asserting DB/API state after
each step. Captures `pageerror` and console errors; screenshots to `scripts/shots/`.

### 6.3 Data safety
- Fresh `pg_dump` to `E:\wms-backups` (+sha256) before the first run.
- All fixtures tagged; cleanup deletes tagged rows (orders, receiving orders, inventory, inventory
  transactions, bills, rate card, users, their audit/op-log rows) — users have no delete endpoint,
  so cleanup uses Prisma directly. Cleanup runs in `finally` and is idempotent.
- Table row counts snapshotted before and compared after; any difference fails the run.
- No real customer, rate card or price is read into fixtures or written anywhere.

### 6.4 Regression gates
Console contract suite: nav-hash baseline changes (new route + permissions). Regenerate with
`--baseline` only after showing the `routes.tsx` / `permissions.ts` diff is additive, then 34/34.

## 7. Delivery
Local commits on `feat/rate-card-system`, **no push**. Report `fullstack_optimization_report_v4.md`
gets a dated v4.43 row (§二) and §四/§五 updates. E6 remains next and still needs the elevated
backup-task registration and admin password rotation before go-live.
