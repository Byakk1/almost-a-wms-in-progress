# Cherry WMS — Master Memorandum

> Synthesis of the 2026-10-29 → 11-03 sessions. One page you can hand to someone cold.
> Detail lives in: `fullstack_optimization_report_v4.md` (v4.42, §二 changelog · §四 open items · §六 PRD) ·
> `docs/plans/2026-10-30-phase4-go-live-readiness.md` · `docs/prd/2026-11-02-e3-user-provisioning.md` ·
> `docs/runbooks/backup-and-restore.md`.

---

## 1. Core alignment

**What this is.** A full-stack 3PL warehouse management system (Cherry WMS) whose business logic — state machines, FIFO allocation, waves, boxes, rate cards (8,211 items / 15,584 zones), billing engine — is built and verified by 15 E2E suites. It is a real system with real commercial data in it.

**What changed in our understanding.** Through v4.38 the project tracked only *feature* debt. The audit on 10-30 showed the true blockers were operational: a public repo + a public JWT fallback secret (forged admin token proved), the admin password effectively published, the API on `0.0.0.0`, and **zero backups** of the only copy of the rate cards. None of these were in any next-step list. **Phase 4 ("Go-Live Readiness") exists to close that class of gap**, and the report gained a §六 PRD so the question "can a business safely run this?" has a home.

**Operating principles we've confirmed by practice**
- Audit the repo before trusting the report ("code leads docs" — now seen 3 times, most recently in reverse: the report *missed* risks rather than lagging progress).
- Verify at the layer that matters: service E2E → HTTP → real browser. A green DOM assertion is not a working feature; a screenshot was read in every case.
- Never claim a check passed until its output was observed; clean every fixture; leave the shared DB as found.
- Additive DDL only, **backup before every DDL** (now actually possible).
- The repo is public **by choice (D1)** → every deployment must be safe with world-readable source.

## 2. Confirmed architecture

| Layer | Decision | Status |
|---|---|---|
| Stack | NestJS 11 + Prisma 7 (PG 15, self-hosted Supabase, no PITR) · React 19 / Vite 7 / antd 5 + ProComponents · Tailwind 4 tokens | unchanged |
| Auth | JWT (7d) + refresh (30d). **Secrets from env only**, `src/common/secrets.ts` fails fast (<32 chars or missing → no boot). Guard re-reads `User.isActive` per request → deactivation is immediate. Login is constant-time and does not disclose account state. | ✅ E1/E3 |
| RBAC | 6 roles enforced by global `RolesGuard` (backend = truth) and mirrored in `permissions.ts` (UX only). **First verified with a persisted non-admin user on 11-02** (OPERATOR → 403 on admin endpoints). | ✅ |
| Network | API binds `127.0.0.1:3001` by default; `HOST=0.0.0.0` is an explicit act for a fronted deployment; CORS via `EXTRA_CORS_ORIGINS`; Vite proxy → `127.0.0.1`. | ✅ E1 |
| Data safety | `scripts/backup-db.sh` → `E:\wms-backups\*.dump` (+sha256, 30-day prune). **Restore rehearsal proven**: 32/32 tables, 24,739 rows identical, content aggregates match. `*.dump` gitignored. | ✅ E2 (scheduling + off-box pending) |
| Users | `src/users/` ×6 endpoints; `/settings/users` page; server-generated one-time temp passwords; soft-disable (never delete — audit integrity); last-admin + self guards; all writes audited without secrets. | ✅ E3 |
| Billing | **E4 delivered (11-03)**: `/bills` drives the real UI (list/detail/generate/finalize/mark-paid); `TaxRate` (21 seeded rows, **half-open windows**) + `Surcharge` (FUEL pass-through, value NULL) live; `charge-calculator` consumed in production; province tax + export zero-rating + provisional lifecycle verified (billing 70 · tax-surcharge 58 · **adversarial audit 27/27** · browser 37/37 + 24/24). Storage rent (CBM·day) still not billed — waived verbatim on the bill → E7. Real-data month pending D3. | ✅ E4 |
| Ops | No Dockerfile / CI / deploy script / monitoring. "Deploy" = hand-started dev servers on this box. | ✗ → E6 (blocked on D2) |

## 3. Key parameters

| Parameter | Value |
|---|---|
| Repo | `github.com/Byakk1/almost-a-wms-in-progress` — **public (intentional)**; branch `feat/rate-card-system` = `c43b3cb`; `main` 24 ahead of `origin/main` |
| Working tree | **Committed locally (11-05)** as 5 commits on `feat/rate-card-system`: console / perimeter / backup / users / billing+tax — **not pushed**. Both `tsc` 0, `vite build` 0 |
| Dev login | `admin@convex-wms.local` / password held privately, never in this repo (SUPER_ADMIN, sole user) — **rotation deferred by user**; hints scrubbed from public files. Browser probes read it from `WMS_ADMIN_PASSWORD` |
| Secrets | `JWT_SECRET`, `JWT_REFRESH_SECRET` (64-hex each) in `wms-backend/.env` only; template `.env.example` tracked |
| Ports | API `127.0.0.1:3001` · Vite `127.0.0.1:5173` · remote DB `…supabase.opentrust.net:5432` · **leftover local PG17 on `:5432`** (contained; needs elevated stop) |
| Backups | `E:\wms-backups\` — 3 dumps (10-30, 11-02 ×2 incl. pre-DDL) · tools `D:\Postgres\bin` |
| Test baseline | Backend **17 suites, 0 failures** (rate-card 101 · billing **70** · tax-surcharge **58** · users 37 · box 29 · charges **24** · tax-audit **27/27 hand-derived** · picking 17 · customer-account 16 · doc-no 14 + 7 more) · browser: users UI 19/19 · E4 finance 37/37 · E4 settings 24/24 |
| Go-live criteria | C1 ◐ · C2 ◐ · C3 ◐ (capability done, awaiting staff) · **C4 ◐ (capability done, awaiting D3 real month)** · C5 ✗ (E5 skipped by user) · C6 ✗ |
| Decisions | **D1 decided** (stay public). **Open: D2** deploy target · **D3** pilot scope · **D4** multi-warehouse at launch |

## 4. Immediate next steps

**You (minutes, one elevated prompt + four answers)**
1. Elevated PowerShell → register `CherryWMS-DB-Backup` + stop/disable `postgresql-x64-17` (both commands in the runbook).
2. ~~Authorize the commit split~~ → **done 11-05** (5 local commits; push is a separate decision).
3. Decide **D2** (where prod runs) and **D3** (which warehouse/customer/staff pilot first). D4 can wait.
4. Two questions for the accountant before the first real invoice: **PST on freight lines** (seeded as taxable per your instruction) and **tax registrant number** (`BILLING_TAX_REG_NO`).

**Me (next session, in order)**
1. **E6 — Deploy + runbook** as soon as D2 lands (secrets injected, restart-safe service, TLS at edge, off-box backup copy).
2. Then E7 storage snapshots → E8 observability → E9 box-in-packing → E10 (D4-gated).
3. When D3 lands: re-prove C4 on the first real shipped month (same fixture-vs-real split as C3), then re-run the E4 browser verification against it.

**Deliberately parked:** E5 mock-page triage (your call), password rotation (your call), external-vantage port scan (can't be done from this box), PDA / dark mode / global search / perf, `submittedAt`/`cancelledAt` stamping (same family as `shippedAt`, no criterion blocked).

---
*Prepared 2026-11-02, updated 2026-11-03 (E4). Every "verified" above corresponds to an observed test output or screenshot recorded in the report's §二 rows v4.39–v4.42.*
