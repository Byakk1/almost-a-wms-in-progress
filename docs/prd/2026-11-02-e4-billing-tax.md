# PRD — E4 Billing + Tax End-to-End (Cherry WMS)

> Phase 4 epic E4 · drafted 2026-11-02 · status: **approved for build 2026-11-02** (owner answered all seven §10 questions; decisions locked in §10)
> Companion docs: `docs/plans/2026-10-30-phase4-go-live-readiness.md` (roadmap) · `docs/prd/2026-11-02-e3-user-provisioning.md` (format precedent) · `docs/runbooks/backup-and-restore.md` (backup before DDL)
> Report cross-refs: `fullstack_optimization_report_v4.md` §二 v4.38 (engine), §四 "v4.40 边界审计" (E4 listed), §六 C4/E4

## 1. Executive summary

We're wiring the **finance screens to the real billing engine** and giving that engine a
**tax + surcharge layer backed by real tables**, so a FINANCE user can generate a customer's
monthly bill from the UI, see every line the API actually computed — including GST/HST by
destination province — and trust that the number on screen is the number in the database.
Today the engine (`BillsService`, v4.38) is real and tested (19/19), but **no screen calls it**:
`/fee/billing` and `/fee/billing/generate` render hardcoded arrays, and "手动生成账单" fabricates a
`Math.random()` bill number. The tax/surcharge calculator (`charge-calculator.ts`, 16/16) is pure
and correct but has **zero production consumers** and no tables to read from — so every bill the
API does produce is **untaxed**. Shipping E4 closes go-live criterion **C4** ("one real month
billed end-to-end UI → API → DB including GST/HST by province; storage either billed or
explicitly waived on the bill; no fake numbers on any finance screen").

## 2. Problem statement

**Who:** the finance user (FINANCE role) who must invoice customers monthly, and the owner who
must be able to trust that invoices are legally correct.

**What:** two independent failures that compound:

1. **The UI lies.** Both finance pages are mock. A FINANCE user who opens 客户账单管理 sees four
   invented bills for invented customers ("深圳市大卖贸易", "Global E-commerce Ltd.") with invented
   storage fees. 月度账单生成 shows "2月份总出账金额 ¥ 70,940.75" — a string literal. Clicking
   生成并下发 does nothing to the database and shows a success toast.
2. **The API under-bills.** `BillsService` prices handling + freight correctly off the rate cards
   but emits **no tax line and no surcharges**. For a Canadian 3PL, that means every invoice is
   short by 5–15 % (GST/HST), and fuel surcharge — which the price list marks 实报实销 — is simply
   absent rather than pending.

**Why it hurts:**
- *Revenue:* untaxed invoices either under-collect (if remitted correctly) or create a tax
  liability the business absorbs. Fuel pass-through is pure margin leakage.
- *Trust:* "people trust screens" (roadmap §C). A finance user acting on the mock page would
  chase payment on bills that don't exist and miss bills that do.
- *Legal:* invoices in Canada must show GST/HST separately with the registrant's number; an
  invoice with no tax line is non-compliant, not merely incomplete.
- *Go-live:* C4 is unreachable while either failure stands.

**Evidence (probed 2026-11-02, all read-only):**
- `grep -rn "bills" wms-frontend/src` → only 3 hits, all in `router/permissions.ts`. **Zero API
  callers** of `/bills` or `/bills/generate`.
- `pages/Billing/index.tsx:22` `const mockBills = [...]`; `pages/Fee/BillingGen/index.tsx:44`
  `` billNo: `BIL-2603-M${Math.floor(Math.random() * 1000)}` ``.
- `grep -rln "TaxRate|Surcharge" wms-backend` → only `charge-calculator.ts` and its test.
  `schema.prisma` has **no** `TaxRate` or `Surcharge` model (35 models; neither present).
- `grep -rn "assembleCharges" wms-backend/src` → defined once, **imported by nothing in `src/`**.
- `bills.service.ts:165-201` assembles `OUTBOUND_HANDLING / SHIPPING / INBOUND_HANDLING /
  UNPRICED` lines only; no `TAX` or `SURCHARGE` kind exists in its `Line` type.
- `CustomerBill.status` is a free `String @default("unpaid")`; nothing ever writes `paidAt`.
  The mock UI shows `PARTIAL / OVERDUE` states the schema cannot represent.
- **Live data cannot prove C4 yet:** `SELECT … WHERE status IN ('SHIPPED','SIGNED') AND
  shippedAt IS NOT NULL` → **0 rows**; `CustomerBill` → **0 rows**. The only billable month today
  is the E2E fixture's (synthetic prices).
- **🔴 `shippedAt` is never written by any production code path** (probed by exhaustive grep over
  `src/`): `ship()` updates only `{ status: 'SHIPPED' }` (`outbound-orders.service.ts:536-539`);
  `shippedAt` is **read** once — by the billing window filter (`bills.service.ts:106`) — and
  written only by the E2E fixture (`e2e-verify-billing.ts:98,106`). The single `SIGNED` order in
  the live DB has `shippedAt = NULL`. **Consequence: every real-data bill would be empty**, no
  matter how much ships, because the window filter matches zero rows. This is the same masking
  pattern as the v4.23 `pickedQty` discovery (read by the completion check, written by nothing;
  E2E seeded it by SQL) — fixed then in v4.31 by adding the missing pick endpoint. Here the fix
  is one line in `ship()`, but **it is in E4 scope because E4's primary metric is unreachable
  without it** (see §5.0).
- **Province data is not normalised:** `recipientProvince` holds `ON` *and* `Ontario`, `QC` *and*
  `Quebec`, `AB` *and* `Alberta`, `BC` *and* `British Columbia`; ~40 orders are **Australian**
  (`NSW`/`New South Wales`, `VIC`/`Victoria`, `QLD`/`Queensland`, `Western Australia`), where the
  tax is 10 % GST, not Canadian GST/HST. A tax table keyed on the raw string would miss roughly
  half the Canadian orders and mis-tax every Australian one.

## 3. Target users

| Persona | Role | Needs from this feature |
|---|---|---|
| **Finance user** — primary | FINANCE | Pick customer + month → generate → see lines, tax, warnings; know which lines are provisional (fuel pending); mark a bill paid; never see a number the API didn't compute |
| **Owner / admin** — secondary | SUPER_ADMIN | Maintain tax rates and surcharge definitions without SQL; audit every bill to an `OperationLog` row; trust the invoice is compliant |
| **Customer service** — secondary | CUSTOMER_SERVICE | Answer "why is my bill X?" by reading the per-line breakdown and the warnings list |
| **Customer** — indirect | CUSTOMER | (Read-only list is already role-permitted; portal linkage is D4 — out of scope) |

## 4. Strategic context

- **Go-live gate.** C4 is one of six exit criteria and the only one about money. E1–E3 made the
  system *safe* to run; E4 makes it *worth* running — a 3PL that cannot invoice is a cost centre.
- **Why now:** E2 (backup + proven restore) is the explicit prerequisite for the additive DDL this
  epic needs (roadmap: "E4 ← E2"). E3 delivered the FINANCE role as a real persisted identity, so
  for the first time a non-admin can exercise this flow in the browser.
- **Why not sooner:** v4.38 deliberately stopped at "engine + pure calculator" and parked the
  schema "for review first, per the standing rule on migrations". That review is this document.
- **Public repo constraint.** Tax *rates* are public law and may live in a seed file. Surcharge
  *amounts* (peak, oversize) are commercial terms → they are data, imported like rate cards, never
  committed. The `.gitignore` already covers `*rate*`/`*ratecard*` patterns; surcharge workbooks
  need the same treatment (see §9).

## 5. Solution overview

Three layers, each independently verifiable, in build order — preceded by one prerequisite fix.

### 5.0 Prerequisite — `ship()` must stamp `shippedAt` (verified gap, §2)

`OutboundOrdersService.ship()` sets `status: 'SHIPPED'` but never `shippedAt`, and billing
filters on `shippedAt`. Fix: `data: { status: 'SHIPPED', shippedAt: new Date() }` in the same
transaction. **Zero DDL** — the column already exists (schema line ~370). Scope guard: this PRD
does **not** also backfill the one existing `SIGNED` row (it was created by a prior verification
run, not a real shipment) and does **not** touch `sign()`, `cancel()`, or `submittedAt` /
`cancelledAt` (same family, same gap — listed in `create-outbound-order.dto.ts:19` as
server-managed, currently unmanaged — but **not** on E4's critical path; logged in §8).
Verified by: the billing E2E gains a case that drives an order through the **real** `ship()`
endpoint instead of writing `shippedAt` directly, and asserts the bill picks it up — closing the
masking loophole the same way `e2e-verify-fifo` was de-rigged in v4.31.

### 5.1 Schema — two additive tables (backup first, `prisma db execute`, idempotent SQL)

Following the v4.38 design in `charge-calculator.ts` (types `TaxRateDef`, `SurchargeDef`) and
the Box / rate-card DDL precedent (TEXT not PG enum; `IF NOT EXISTS`; FK in `DO $$ … $$`).

**`TaxRate`** — one row per (jurisdiction, taxType, effective window).
`id · countryCode (TEXT, e.g. 'CA') · jurisdiction (TEXT, canonical province/state code 'ON') ·
taxType (TEXT: GST|HST|PST|QST) · ratePercent (DECIMAL(6,3)) · effectiveFrom (DATE) ·
effectiveTo (DATE NULL) · isActive · createdAt/updatedAt`.
Unique on `(countryCode, jurisdiction, taxType, effectiveFrom)`. Seeded with the 13 Canadian
provinces/territories (public law — safe to commit) and a single `AU / * / GST 10` row so the
Australian orders already in the DB are not silently untaxed.

**`Surcharge`** — one row per surcharge definition.
`id · code (TEXT UNIQUE: FUEL|PEAK|OVERSIZE|RTS…) · name · calcType (TEXT: FLAT|PERCENT_OF_BASE|
PASS_THROUGH) · value (DECIMAL(12,4) NULL) · taxable (BOOL default true) · carrier (TEXT NULL —
null = all carriers) · appliesTo (TEXT: SHIPPING|HANDLING|ALL) · note · effectiveFrom/To ·
isActive`. Values are **data**, imported via a `scripts/import-surcharges.ts` that, like
`import-rate-card.ts`, refuses in-repo paths and runs dry by default.

**`BillItem`** — two additive nullable columns so the invoice can be reconstructed:
`kind (TEXT NULL: BASE|SURCHARGE|TAX|UNPRICED)` and `isProvisional (BOOL default false)`.
Existing rows read as `kind = NULL` → treated as BASE by the UI (backward compatible).

**`CustomerBill`** — two additive columns: `isProvisional (BOOL default false)` (true while any
PASS_THROUGH line is pending) and `taxRegistrationNo (TEXT NULL)` snapshot (invoice compliance;
value sourced from a new `BILLING_TAX_REG_NO` env var — not committed).

**No `migrate dev`, no `db push`, no `ALTER TYPE`.** `migrate diff` before/after to confirm the
live DB ↔ schema set stays empty, same as E3.

### 5.2 API — make the calculator a consumer, add the missing verbs

| Method | Path | Roles | Change |
|---|---|---|---|
| POST | `/bills/generate` | SUPER_ADMIN, FINANCE, CS | **Body becomes a DTO** (`GenerateBillDto`: `customerId`, `period`, optional `actuals: [{code, amount}]` for pass-through). Service resolves province → `TaxRate[]`, active `Surcharge[]` → calls `assembleCharges` **per shipped order** → aggregates `SURCHARGE` and `TAX` lines alongside existing ones. `isProvisional` set if any fuel pending. Still one transaction, still posts to balance (provisional bills post the knowable amount; the delta posts on finalisation). |
| GET | `/bills` | + CUSTOMER | Add `period`, `status`, `isProvisional` filters + standard `ok(data, pagination)` envelope (today returns an unpaginated array). |
| GET | `/bills/:id` | same as list | **New.** Full bill + items + source-event counts + warnings (warnings are not persisted today — persist them as a `BillItem` of `kind=UNPRICED`? No: add `CustomerBill.warnings JSONB NULL`, additive). |
| POST | `/bills/:id/finalize` | SUPER_ADMIN, FINANCE | **New.** Accepts the missing `actuals`; recomputes tax over the now-complete base; posts the balance delta; clears `isProvisional`. Refused if no lines were pending. |
| POST | `/bills/:id/mark-paid` | SUPER_ADMIN, FINANCE | **New.** Sets `status='paid'`, `paidAt=now()`, writes a `CustomerTransaction` of type `payment` (+amount) and `OperationLog`. Refused on provisional bills. |
| GET/POST/PUT | `/tax-rates` | read: SUPER_ADMIN, FINANCE · write: SUPER_ADMIN | **New.** CRUD; no delete (set `effectiveTo` / `isActive=false`). |
| GET/POST/PUT | `/surcharges` | same | **New.** CRUD; no delete. |

**Province normalisation** is a pure function `normalizeProvince(country, raw) → code | null`
(`'Ontario' → 'ON'`, `'New South Wales' → 'NSW'`, case/whitespace-insensitive), unit-tested with
every distinct value currently in the DB. An unresolvable province becomes a **warning + untaxed
line flagged `isProvisional`**, never a silent 0 % — the same principle as fuel.

**Tax base rule** (from `charge-calculator.ts`): tax = Σ(taxable lines) × rate; applied
**after** surcharges; pending pass-throughs excluded and flagged. `INBOUND_HANDLING` and
`OUTBOUND_HANDLING` are taxable services in Canada and are included in the base — this differs
from the v4.38 calculator which only knew about `BASE_FREIGHT`; the service passes handling as
additional taxable base lines (a small, tested extension of `assembleCharges`' input shape).

### 5.3 Frontend — retire both mocks, add two settings pages

- **`/fee/billing` 客户账单管理** → `GET /bills` (paginated, filters customer/period/status) →
  detail drawer from `GET /bills/:id`: header (customer, period, status, provisional badge, tax
  reg no), **lines grouped by `kind`** (BASE → SURCHARGE → TAX, with UNPRICED in a warning
  block), warnings list verbatim from API, balance before/after. Row actions: 标记已付
  (`bill.pay` gate), 补录实报实销 (opens finalize modal, only when provisional). **Storage shows
  as an explicit "仓储费未计入" notice sourced from the API warning**, satisfying C4's "waived on
  the bill output" clause.
- **`/fee/billing/generate` 月度账单生成** → customer selector (`GET /customers`) + month picker
  (`YYYY-MM`, not a date range — the API is monthly) + optional pass-through actuals table →
  `POST /bills/generate` → success shows the real bill in the drawer. KPI cards computed from the
  real list for the selected month. The "每月 1 日凌晨自动月结" card is **removed** — no scheduler
  exists and the page must not promise one.
- **`/settings/tax-rates`** and **`/settings/surcharges`** — ProTable + edit drawer, mirroring
  `/settings/rate-cards` and `/settings/users` conventions; write actions gated `billing.config`
  (SUPER_ADMIN).
- `router/permissions.ts` additions (pure append, mirroring controller `@Roles`): `'bill.pay'`,
  `'bill.finalize'`, `'billing.config'`, `'/settings/tax-rates'`, `'/settings/surcharges'`.
- All currency rendering: the engine is currency-agnostic today (rate cards carry `currency`);
  the UI shows the card currency, **not a hardcoded `¥`** (both mocks hardcode `¥` for a CAD
  business).

## 6. Success metrics

| Kind | Metric | Target |
|---|---|---|
| **Primary** | A month generated from the UI whose on-screen total equals `CustomerBill.amount` equals Σ`BillItem.totalAmount`, **including a TAX line whose rate matches the destination province's `TaxRate`** | 1 month, verified UI ⇄ API ⇄ DB (C4) — on the E2E fixture now, on pilot data when D3 ships orders |
| Secondary | Mock residue on finance screens | **0** string literals / `Math.random` / `setTimeout` fakes in `Billing`, `BillingGen` (grep-verified) |
| Secondary | Tax coverage of existing orders | every distinct `recipientProvince` value in the live DB resolves to a `TaxRate` or is flagged provisional — **0 silently untaxed** |
| Secondary | Fuel handling | a bill with a `PASS_THROUGH` surcharge and no actual is `isProvisional=true` and **cannot be marked paid**; after `finalize` it is final and tax reflects the added base |
| Guardrail | Balance integrity | Σ`CustomerTransaction.amount` == `Customer.balance` for the fixture customer after generate → finalize → pay (existing `e2e-verify-customer-account` invariant) |
| Guardrail | Regressions | all 15 backend suites green; `e2e-verify-billing` extended, `e2e-verify-charges` extended (still DB-free); new `e2e-verify-tax-rates.ts` |
| Guardrail | Committed secrets / prices | **0** — surcharge values via import script only; `.gitignore` extended for `*surcharge*.{xlsx,csv,json,sql}` and verified with `git add --dry-run` |

## 7. User stories & acceptance criteria

**Epic hypothesis.** We believe that wiring the finance UI to `/bills` and making
`charge-calculator` consume real `TaxRate`/`Surcharge` tables will let a FINANCE user produce
legally complete invoices from the screen, because the pricing engine is already correct and
tested — what is missing is the tax/surcharge layer's data and the UI's connection to any of it.

### S0 — Shipping stamps the timestamp billing reads
*As the owner, an order shipped through the real endpoint appears on that month's bill.*
- [ ] `POST /outbound-orders/:id/ship` sets `shippedAt` (UTC now) in the same transaction as `status='SHIPPED'`
- [ ] `e2e-verify-billing` adds an order driven through the **real** `ship()` (not a direct `shippedAt` write) and asserts it is billed; the fixture's direct writes remain only for the out-of-window / unshipped negative cases
- [ ] `grep -rn "shippedAt" src/` shows a writer in `outbound-orders.service.ts` (today: reader only)

### S1 — Generate a real monthly bill from the UI
*As a finance user, I select a customer and a month and get the bill the API computed.*
- [ ] `POST /bills/generate` accepts a validated DTO (400 on bad `period`, 404 unknown customer, 409 if bill exists — today this is a 400; align with E3's 409 convention)
- [ ] Response includes `lines[]` with `kind ∈ {BASE,SURCHARGE,TAX,UNPRICED}`, `warnings[]`, `isProvisional`, `balanceBefore/After`
- [ ] The UI drawer renders every line and every warning verbatim; total shown == `amount` in DB
- [ ] Month picker produces `YYYY-MM`; no date-range picker

### S2 — Tax by destination province
*As the owner, every shipped order is taxed at its destination's rate or explicitly flagged.*
- [ ] `TaxRate` table seeded for CA (13 jurisdictions) + AU GST; seed is idempotent SQL in `prisma/sql/`
- [ ] `normalizeProvince` resolves all 15+ distinct values currently in `OutboundOrder.recipientProvince` (table-driven unit test enumerates them)
- [ ] An order with an unresolvable or missing province → warning `目的地省份无法识别，该单未计税` + `isProvisional=true`; **never 0 % silently**
- [ ] Tax line `code` = `${taxType}_${jurisdiction}`, one line per (type, jurisdiction) pair aggregated across the month (HST_ON, GST_AB, …) so the filing split is visible
- [ ] Handling fees are inside the taxable base (documented in the service header)

### S3 — Surcharges, including pass-through
*As a finance user, fixed and percentage surcharges apply automatically; fuel waits for the carrier bill.*
- [ ] Active `Surcharge` rows matching `(carrier | null, appliesTo)` apply per order via `assembleCharges`
- [ ] `PASS_THROUGH` with no actual → `amount=null`, `pending`, bill `isProvisional=true`
- [ ] `POST /bills/:id/finalize` with `actuals[]` → recomputes tax over the completed base, posts balance **delta** only, sets `isProvisional=false`; refused (400) if nothing was pending or if an actual's `code` isn't pending
- [ ] Surcharge values enter only via `scripts/import-surcharges.ts` (`--commit` gate, refuses repo paths); no numeric surcharge value appears in any committed file

### S4 — Mark paid
*As a finance user, I record payment and the ledger agrees.*
- [ ] `POST /bills/:id/mark-paid` → `status='paid'`, `paidAt`, `CustomerTransaction{type:'payment', amount:+total}`, `Customer.balance` updated, `OperationLog` — one transaction
- [ ] Refused on provisional bills (400 with reason) and on already-paid bills (409)
- [ ] UI row action gated by `bill.pay`; hidden for CS and CUSTOMER

### S5 — Maintain tax rates and surcharge definitions
*As an admin, I keep rates current without SQL.*
- [ ] `/settings/tax-rates`, `/settings/surcharges` pages: list, create, edit; **no delete** (end-date instead)
- [ ] Writes SUPER_ADMIN-only; FINANCE read-only; OPERATOR 403 + hidden menu (mirrors rate-cards)
- [ ] Every write → `OperationLog` with before/after
- [ ] Overlapping effective windows for the same `(countryCode, jurisdiction, taxType)` are refused at the service layer (same spirit as the rate-card tier-overlap check)

### S6 — Finance screens contain no fabricated data
- [ ] `grep -n "mock\|Math.random\|setTimeout\|¥ 70,940\|BIL-2603" pages/Billing pages/Fee/BillingGen` → 0
- [ ] "系统自动月结日" card removed (no scheduler exists)
- [ ] Currency label comes from the rate card / bill, not a hardcoded `¥`

### Edge cases & constraints
- **Re-running a month** stays refused (existing behaviour) — but a *provisional* bill may be finalised; that is the only mutation path for a generated bill's lines.
- **Mixed-country months**: a customer shipping to both CA and AU in one month gets both `HST_ON` and `GST_AU` lines; tax base is computed per order, aggregated per (type, jurisdiction).
- **`shippedAt` is null on every current order and `ship()` never sets it** — resolved by §5.0
  (in scope, verified, not hypothetical). The billing window filter is correct as written; it was
  the producer that was missing.
- **Rounding**: keep `round2` at line level then sum (matches `charge-calculator`); the DB `Decimal` stores 2 dp for money, 3 dp for rates.
- **Existing `CustomerBill` rows**: none in live DB → no backfill needed; E2E fixture is wiped per run.

## 8. Out of scope

- **Storage (CBM·day) billing** — needs daily snapshots (E7). The bill **states** it is unbilled; that satisfies C4's "or explicitly waived" clause.
- **Scheduled / automatic month-end generation** — no scheduler infra; the mock's promise is removed, not fulfilled.
- **PDF / print / export** — the mock's 打印 and 批量导出 buttons do nothing; they are removed. A compliant printable invoice (with registrant number, bilingual labels) is a follow-up once a real month exists to print.
- **Partial payments / overdue aging** — `PARTIAL` and `OVERDUE` states on the mock have no schema support; `status` stays `unpaid | paid` (+ `isProvisional`). Aging can be derived client-side from `dueDate` later.
- **Multi-currency conversion** — rate cards carry currency; bills inherit it; no FX.
- **PST/QST provincial complexities** (e.g. QC compounding rules) — modelled as separate `TaxRate` rows; compounding is not applied (Canada stopped compounding QST on GST in 2013, so additive is correct today).
- **Customer portal view of bills** (`CUSTOMER` role) — D4.
- **Dunning / payment reminders / email** — no mail infra (same as E3).
- **`submittedAt` / `cancelledAt` stamping** — same unmanaged-timestamp family as `shippedAt`
  (`create-outbound-order.dto.ts:19` lists them as server-managed; nothing manages them). Not on
  E4's path; logged for the report's §四 as a follow-up so it is not rediscovered.

## 9. Dependencies & risks

| Risk | Mitigation |
|---|---|
| DDL on the shared, previously-unbacked-up DB | E2 in place: `backup-db.sh` run immediately before `prisma db execute`; DDL idempotent; `migrate diff` empty-set check before/after (E3 precedent) |
| Dirty province strings mis-tax or skip orders | `normalizeProvince` is table-driven and unit-tested against every distinct live value; unresolvable → provisional + warning, never silent |
| Fuel defaulting to 0 (the exact failure v4.38 guarded against) | `PASS_THROUGH` stays `null`/pending at every layer; `mark-paid` refuses provisional bills; UI badge |
| Tax on tax / missing surcharges in the base | Order fixed in `assembleCharges` (surcharges → base → tax), already pinned by `e2e-verify-charges`; extended for handling lines |
| Commercial surcharge values leak into the public repo | Import-script-only path; `.gitignore` extension verified with `git add --dry-run` against a decoy `surcharges.xlsx` placed inside `src/` |
| C4 cannot be proven on real data (0 shipped orders) | Prove on the E2E fixture now (synthetic prices, real code path); re-prove on the first pilot month when D3 lands — identical to how C3 is "capability delivered, awaiting staff" |
| `ship()` never stamps `shippedAt` → every real bill empty (**verified**, not a risk — a defect) | §5.0 one-line fix + E2E case that ships through the real endpoint; without it E4's primary metric is unreachable on any real data |
| `BillsModule` already imports `RateCardsModule`; adding `TaxRatesModule`/`SurchargesModule` changes assembly again | Full 15-suite regression after wiring (v4.39 showed this is necessary, not optional) |
| Tax registrant number committed by accident | Sourced from env (`BILLING_TAX_REG_NO`), documented in `.env.example` with a placeholder |

**Dependencies:** E2 (done) · E3 (done — FINANCE role exists to test with) · the 10 active rate cards (done) · **D3** for real-data proof (not for capability).

## 10. Decisions — locked 2026-11-02 (owner answered all seven; §5 is authoritative where it elaborates)

| # | Question | Decision | Build consequence |
|---|---|---|---|
| 1 | Tax basis (CA) | **Place-of-supply = destination province.** GST 5 / HST 13–15 / GST+PST or QST, by province, never a flat national rate | `TaxRate` keyed on `(countryCode, jurisdiction)`; resolution from the order's `recipientCountry` + normalised `recipientProvince`; one `TAX` line per `(taxType, jurisdiction)` |
| 2 | Non-CA destinations | **0 % export service + flag for manual review.** Owner answered for AU; the DB also holds NZ (4) and US (1) orders — same rule applied to **every non-CA country**, not an AU special case | Explicit `TAX` line at 0 % (`GST_AU 0.00`), warning `出口零税率，待人工复核`, bill `isProvisional=true`; cleared by `finalize` with confirmation code `EXPORT_ZERO_RATED` |
| 3 | Handling fees taxable? | **Yes — ancillary rule**: handling follows the main supply's rate (13 % order → 13 % handling; 0 % order → 0 % handling) | Handling passed to `assembleCharges` as additional taxable base; **inbound** handling taxed at the **warehouse's** province, parsed from `Warehouse.address` (`CA/BC/…`, `CA/ON/…`, `AU/NSW/…` — structured, probed) — no DDL needed; unparsable address → warning + provisional |
| 4 | Fuel pass-through timing | **Per-bill at finalise** (exact carrier-invoiced amount; no FX/estimate drift) | `POST /bills/:id/finalize { actuals[] }`; pending line stays `null`; **no** per-order estimate field |
| 5 | Surcharge catalogue | **FUEL only at launch.** Import feature only if non-fuel surcharges later exceed ~5 % of operational cost | `Surcharge` table + CRUD + one seeded `FUEL / PASS_THROUGH` row; **no import script in E4** (removed from §5.1/§9 scope) |
| 6 | Bill status | **`unpaid \| paid` + `isProvisional`; no `partially_paid`.** `paid`+`isProvisional=true` is a valid state (payment received against a provisional/escrow amount; ledger not yet closed); `paid`+`false` is the end state | `mark-paid` is **allowed on provisional bills** (reverses the earlier PRD draft); `finalize` remains the only way to clear `isProvisional` and may run before or after `mark-paid`, posting only the balance delta |
| 7 | Who may mark-paid | **FINANCE + SUPER_ADMIN only — CS explicitly excluded** (cash confirmation is an internal-control function) | Controller `@Roles('SUPER_ADMIN','FINANCE')` on `mark-paid` and `finalize`; `permissions.ts` `'bill.pay'`/`'bill.finalize'` mirror it; CS keeps read + generate as today |

**Still owner's call after build (not blocking):** PST applicability to *freight* lines varies by province (e.g. common-carrier exemptions) — seeded as taxable per decision 1/3; accountant to confirm before the first real invoice. Tax registrant number (`BILLING_TAX_REG_NO`) to be supplied in `.env` when known.
