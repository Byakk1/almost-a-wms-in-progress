# Cherry WMS — Phase 4: Go-Live Readiness (working roadmap)

> Draft for review, 2026-10-30. Inputs: same-day full-stack regression re-run + perimeter audit.
> This is a plan, not a commitment — re-sequence as the open decisions land.
>
> **Goal:** move from "logic verified in dev" to "safely operated by real staff against real data."
> Phase 4 is done when a warehouse crew, a finance user, and an admin can run a full month
> end-to-end — shipping, billing, closing — on a deployment that survives restarts, mistakes,
> and outsiders.

---

## Go-live exit criteria (definition of done)

| # | Criterion | Today |
|---|---|---|
| C1 | **Perimeter closed**: external scan shows only intended ports; a token forged with the public fallback secret gets 401; `JWT_SECRET` required at boot (fail fast); admin credential rotated off public documentation; login page shows no credential hint | ◐ **2026-11-02:** fail-fast secrets ✓ · forged-token → 401 ✓ · bind 127.0.0.1 ✓ · credential hints scrubbed ✓ · **password rotation deferred by user** · external scan still unproven |
| C2 | **Recoverability**: full `pg_dump` baseline stored off-box; restore rehearsal completed into a scratch DB; RPO/RTO documented; additive-DDL-only policy retained | ◐ **2026-11-02:** 2 dumps + checksums ✓ · restore rehearsal 32/32 tables, 24,739 rows identical ✓ · `backup-db.sh` + runbook ✓ · **scheduled task needs elevated registration** · **off-box copy pending D2** |
| C3 | **Users**: ≥3 staff onboarded across OPERATOR / CS / FINANCE without SQL; password reset + deactivate work; RBAC menu/button gating exercised by a real non-admin | ◐ **2026-11-02: capability delivered + verified** (E2E 37/37, HTTP 15/15, UI 19/19; real OPERATOR login → 403 on admin endpoints) · awaiting real staff (D3) |
| C4 | **Money**: one real month billed end-to-end (UI → API → DB) including GST/HST by province; storage-fee decision implemented or explicitly waived in the bill output; no fake numbers visible in any finance screen | ✗ UI is mock, no tax |
| C5 | **Screens**: every menu entry either reads/writes real data or is removed from the menu; zero mock pages reachable by staff | ✗ ~15 of 39 pages mock |
| C6 | **Operations**: restart-safe service, secrets from env only, TLS at the edge, runbook, uptime + error monitoring with alert targets | ✗ none |

---

## Inputs (audit evidence, 2026-10-30 — probes, not assumptions)

### A. Perimeter
- **The GitHub repo is public.** Unauthenticated `api.github.com/repos/Byakk1/almost-a-wms-in-progress` → `"private": false`. `feat/rate-card-system` = HEAD (`c43b3cb`), i.e. the entire backend + frontend incl. auth code is world-readable.
- **The signing secret is in that public code, and is the active secret.** `process.env.JWT_SECRET || 'wms-dev-secret'` appears in 5 places (`app.module.ts:41`, `auth.module.ts:9`, `auth.service.ts:119/177`, `jwt-auth.guard.ts:35`). `.env` contains only `DATABASE_URL` → the running instance signs with the fallback. **Proof:** a JWT signed with `wms-dev-secret` → `GET /api/v1/auth/me` = **200, SUPER_ADMIN**; control token signed with a different secret → **401**.
- **The live admin credentials are effectively public.** `seed.sql` (public) comments name the dev password; `Login/index.tsx` (public) placeholder shows it; README (public) names `admin@convex-wms.local`; and the live shared DB bcrypt-verifies that same password for that user (the only user in the DB). *(Value deliberately not repeated here — it is still live; rotation deferred.)*
- **The API binds all interfaces on a publicly-addressed host.** `netstat` → `0.0.0.0:3001 LISTENING`; a self-connect to the box's public IP on :3001 succeeded (hairpin). External-vantage scan not completable from this box — treat as open until proven otherwise. Swagger UI is served at `/api/docs`. CORS is localhost-only, which is irrelevant to scripted clients.
- **What sits behind that door is the crown jewel.** The DB contains the imported commercial rate cards (8,118 items / 15,584 zones) — the exact asset `.gitignore` works hard to keep out of git — plus imported customer fulfillment data. The perimeter, not the git history, is the practical leak surface.
- Minor: `scripts/import-rate-card.ts` (public) still cites real tier-boundary values (`0.101 / 25.001 / 27.501`) in a comment. DB hostname is named in public README (hostname only — no credentials/connection strings were ever committed; verified via `git log -S`).

### B. Operations
- **No backup exists.** No `pg_dump` on the box; the provider has no managed PITR (report v4.22); the DB is shared/remote and holds the only copy of the imported rate cards.
- **No deployment artifacts.** No Dockerfile, no `.github/` CI, no deploy script/runbook. Current "deploy" = dev servers started by hand.
- **No user management.** `AuthController` = login / refresh / logout / me / change-password only. 6 roles exist in the schema; exactly 1 user exists; onboarding anyone requires SQL.

### C. Product
- **Finance screens are mock while the backend is real** (most dangerous mismatch — people trust screens):
  - `pages/Billing/index.tsx` → `mockBills` array + `setTimeout`.
  - `pages/Fee/BillingGen/index.tsx` → hardcoded `BIL-2603-*` rows + `Math.random()` bill numbers.
  - **Zero frontend callers of `/bills`** — the real engine (v4.38) is unreachable from the UI.
- **Tax/surcharge layer is orphaned.** `src/billing-charges/charge-calculator.ts` has zero production consumers (only its own E2E test); `TaxRate` / `Surcharge` tables do not exist in DB or schema. Invoices currently carry no tax.
- **Storage rent (CBM·day) is not billed** — documented decision (v4.38), needs a daily snapshot table.
- **~15 of 39 page files have no data wiring**: Billing, Customer/CreditApply, Document/{index,Intercept,Return}, FBA/{index,Order}, Fee/BillingGen, Inbound/{Claim,PutawayDiff}, Outbound/Shipment, Settings, Warehouse/{Barcode,InventoryCheck,Material} (+/- 2; heuristic).
- Box creation still has no UI path (report v4.22 gap).

### D. Green baseline to preserve
- 14/14 backend E2E suites pass (re-run 2026-10-30): box 29 · picking 17 · customer-account 16 · doc-no 14 · rate-card 101 · billing 19 · charges 16 · fifo · wave · outbound-create · putaway · putaway-rules · dashboard-inventory · outbound-fields. Zero fixture residue.
- Console suite 34/34 · FE build 0 · live read-only smoke passed.

---

## Epics

| # | Epic | Hypothesis (If → then → because) | Success metric | Size | Outcome |
|---|---|---|---|---|---|
| **E1** | Close the perimeter / secret hygiene | If boot fails without a strong `JWT_SECRET`, the admin credential leaves public documentation, and inbound is restricted to intended interfaces — then the API stops being a data-exfiltration path for the rate cards, because today the open door is the leak surface | Forged-token → 401; external scan clean; 0 credential hints in public files | S | Safety |
| **E2** | Backups + restore rehearsal | If a nightly dump lands off-box and a restore rehearsal is proven — then a bad DDL/delete costs hours, not the business, because there is no PITR and no second copy | Restore rehearsal pass; RPO ≤ 24h documented | S/M | Survival |
| **E3** | User provisioning + RBAC in practice | If admins create/deactivate users and assign roles/warehouses in-app — then onboarding needs no SQL and the 6-role model is real, because today one SQL-only user exists | ≥3 staff onboarded w/o SQL; menus/buttons filtered for a real non-admin | M | Operations |
| **E4** | Bills + tax end-to-end | If the finance UI drives `/bills` and `charge-calculator` consumes real `TaxRate`/`Surcharge` tables — then invoices are legally correct and finance trusts the screens, because today the UI fabricates and the API bills untaxed | Generated month matches UI ⇄ API ⇄ DB incl. province tax | M | Revenue / Trust |
| **E5** | Mock-screen triage (hide or wire) | If every staff-reachable screen is real or hidden before launch — then operators never act on fabricated data, because ~15 pages currently fabricate | 0 mock routes in menu; disposition logged per page | M | Trust |
| **E6** | Deploy + ops runbook | If the stack runs as a supervised service with env-injected secrets and TLS at the edge — then a reboot is a non-event and deploy doesn't depend on a terminal session | Restart-safe; runbook rehearsed | M | Survival |
| **E7** | Storage (CBM·day) billing | If daily inventory snapshots exist — then storage rent (a core 3PL revenue line) stops being silently uncollected | Storage line present on a real bill | M/L | Revenue |
| **E8** | Observability basics | If errors, uptime, and DB health are watched with alert targets — then outages are noticed by the system, not the customer | Uptime check + error hook + alert target | S | Operations |
| **E9** | Box creation in the packing flow | If packing can create boxes — then boxes appear naturally in the workflow instead of via scripts | Packing run creates its own boxes | S | Operations |
| **E10** | Multi-warehouse isolation | Decision-gated: only if launch spans warehouses | Per-identity scoping exercised | L | — |

---

## Sequencing

**NOW — Week 1 (blockers)**
- E1 (decide D1 first; ~half a day of work)
- E2 (first dump + rehearsal)
- E3 (start; smallest viable: users module + admin screen)
- E5 triage pass **immediately** — hiding unwired pages is cheap and removes operator-facing fake screens today

**NEXT — Weeks 2–4 (completeness)**
- E4 (needs: E2 done for backup-before-DDL; the v4.38 `TaxRate`/`Surcharge` schema draft gets its review and additive DDL)
- E6 (after E1, so secrets are designed in rather than bolted on)
- E5 execution (wire or kill each page)
- E7 design (snapshot table design + backfill feasibility)

**LATER — post first real month**
- E7 build · E8 · E9 · E10 (gate on D4)

**Dependencies:** E4 ← E2 (backup before new DDL) · E6 ← E1 (secrets by design) · E7 ← E2 + additive DDL policy.

---

## Deliberately NOT on this roadmap

PDA/handheld scanning, dark mode, i18n, global search, pick-cart drawer, SKU batch picker, performance tuning, Playfair-style typography work. None of these blocks running a first real month; revisit once C1–C6 hold.

---

## Open decisions (owner: user)

| # | Decision | Blocks | Options |
|---|---|---|---|
| D1 | ~~Repo visibility intent~~ → **decided 2026-10-30: stays public (portfolio).** E1 therefore = "safe even though code is public": per-deployment secrets, fail-fast boot, loopback bind, no credential hints in docs. | — | — |
| D2 | **Where does "prod" run?** This box / a server / customer site | E6 | — |
| D3 | **Pilot scope**: which warehouse, customer, and staff go first | E3/E5 order | — |
| D4 | **Multi-warehouse at launch?** | E10 gate | — |

---

## Appendix — what today's regression proved (so Phase 4 doesn't re-litigate it)

- The v4.38-flagged cross-suite regression after `BillsModule → RateCardsModule` **passed 14/14**; the app assembly change is verified safe.
- The 09-30 operations-console batch (Dashboard / shell / outbound list+detail / packing) re-verified today: contract suite 34/34, build green, live read-only smoke green, 0 page errors. It remains **uncommitted** pending your go-ahead.
