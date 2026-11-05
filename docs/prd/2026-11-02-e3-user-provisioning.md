# PRD — E3 User Provisioning (Cherry WMS)

> Phase 4 epic E3 · drafted 2026-11-02 · status: **approved for build** (user chose E3 over E5)
> Companion docs: `docs/plans/2026-10-30-phase4-go-live-readiness.md` (roadmap) · `docs/runbooks/backup-and-restore.md`

## 1. Executive summary

We're building an admin-only **user management module** (API + `/settings/users` page) so a
SUPER_ADMIN can create, edit, deactivate and reset passwords for staff accounts with a role and
an optional home warehouse — without touching SQL. Today the system has exactly **one** account,
created by `seed.sql`; the six-role RBAC that both backend (`@Roles`) and frontend
(`permissions.ts`) already enforce has never been exercised by a second human. Shipping this
unblocks go-live criterion **C3** ("≥3 staff onboarded across OPERATOR / CS / FINANCE without SQL")
and makes the "SUPER_ADMIN shares one password" anti-pattern unnecessary.

## 2. Problem statement

**Who:** the warehouse owner/admin (SUPER_ADMIN) who has to bring real staff onto the system.

**What:** there is no way to create a user. `AuthController` exposes only
`login / refresh / logout / me / change-password`. `User` rows can be created only by hand-written
SQL against the shared Postgres — and nobody on the warehouse floor can or should do that.

**Why it hurts:**
- *Security:* the only workable "onboarding" today is handing out the single admin credential, which
  turns every operator into SUPER_ADMIN and makes audit logs (`operatorId`) meaningless.
- *Operations:* leaving staff (or a compromised credential) cannot be locked out — there is no
  disable path; the only lever is deleting the row, which orphans `OperationLog` references.
- *Go-live:* C3 cannot be met; the RBAC gating built in v4.20 is unproven against a real second user.

**Evidence (probed 2026-10-30 → 11-02):**
- `SELECT count(*) FROM "User"` → **1** (`admin@convex-wms.local`, SUPER_ADMIN).
- `grep -rn "register|createUser|users'" wms-backend/src` → **0** user-creation endpoints; no `src/users/`.
- `prisma/schema.prisma` `model User` has **no `isActive`/status column** → deactivation is impossible without DDL.
- RBAC exists on both sides (`RolesGuard` + `permissions.ts`) but has only ever been tested with injected tokens (v4.20), never with persisted non-admin users.

## 3. Target users

| Persona | Role | Needs from this feature |
|---|---|---|
| **Admin (owner)** — primary | SUPER_ADMIN | Add a new hire in <1 min; set role + warehouse; disable a leaver instantly; reset a forgotten password without seeing it |
| **Warehouse admin** — secondary | WAREHOUSE_ADMIN | See who has access to *their* warehouse; cannot mint admins |
| **Staff** — indirect | OPERATOR / CS / FINANCE | Receive a temp password, log in, be forced/encouraged to change it; see only the menus their role allows |

## 4. Strategic context

- **Go-live gate.** C3 is one of six exit criteria; C1 (perimeter) partially depends on it too —
  "rotate the admin password" is only safe once there is a second admin to fall back on.
- **Why now:** E1 and E2 (done 2026-11-02) removed the two catastrophic risks (forged tokens,
  no backups). Users is the next item that blocks *any* real pilot (D3), and it is the
  prerequisite for E4/E5 being tested by non-admin roles.
- **Public repo constraint.** Everything here must be safe with world-readable source: no default
  passwords, no secrets in code, temp passwords generated server-side and shown once.

## 5. Solution overview

**Backend — `src/users/`** (`UsersModule`, controller, service, DTOs), all routes
SUPER_ADMIN-only except where noted:

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/users` | SUPER_ADMIN, WAREHOUSE_ADMIN | paginated; `keyword`, `role`, `isActive`, `warehouseId` filters; WAREHOUSE_ADMIN sees only their warehouse |
| POST | `/users` | SUPER_ADMIN | create; **server generates a 12-char temp password**, returned **once** in the response, stored only as bcrypt |
| PUT | `/users/:id` | SUPER_ADMIN | name / role / warehouseId / email |
| POST | `/users/:id/deactivate` | SUPER_ADMIN | soft-disable; login refused; existing JWTs rejected on next request |
| POST | `/users/:id/reactivate` | SUPER_ADMIN | — |
| POST | `/users/:id/reset-password` | SUPER_ADMIN | new server-generated temp password, returned once |

**Schema (additive DDL only — backup taken 2026-11-02 before any change):**
`User.isActive BOOLEAN NOT NULL DEFAULT true`, `User.lastLoginAt TIMESTAMPTZ NULL`.
Via `prisma/sql/user_provisioning_additive.sql` + `prisma db execute` (same path as Box / rate cards).

**Auth integration:** `login()` refuses `isActive=false` with the same generic message as a bad
password (don't disclose account state); `JwtAuthGuard` re-checks `isActive` so a deactivated
user's still-valid 7-day token stops working immediately.

**Frontend — `/settings/users`** under 系统设置: ProTable list (name, email, role tag, warehouse,
status, last login) → create drawer → edit drawer → row actions *重置密码* / *停用* / *启用*. The temp
password appears in a one-time modal with a copy button and the text "此密码仅显示一次".

**Audit:** every write produces an `OperationLog` (`entityType: 'USER'`, actions
`CREATE / UPDATE / DEACTIVATE / REACTIVATE / RESET_PASSWORD`) with before/after snapshots
**excluding** `passwordHash`.

## 6. Success metrics

| Kind | Metric | Target |
|---|---|---|
| **Primary** | staff accounts created via UI (not SQL) | ≥3 across OPERATOR / CS / FINANCE before pilot (C3) |
| Secondary | time admin→new login | < 2 min end to end |
| Secondary | RBAC proven with persisted users | a real OPERATOR login sees the filtered menu and gets 403 on an admin endpoint |
| Guardrail | admin lock-out incidents | **0** — enforced by the last-admin + self-deactivate guards |
| Guardrail | regressions | all existing E2E suites stay green; new `e2e-verify-users` added |

## 7. User stories & acceptance criteria

**Epic hypothesis.** We believe giving SUPER_ADMIN an in-app user-management module will let the
warehouse onboard real staff with least-privilege roles in minutes, because the RBAC already exists
and the only missing piece is a way to create the identities it applies to.

### S1 — Create a staff user
*As an admin, I create a user with email, name, role, optional warehouse so a new hire can log in.*
- [ ] `POST /users` validates: email format + unique (409 on duplicate, case-insensitive), role ∈ enum, warehouseId exists if given
- [ ] response contains `tempPassword` exactly once; DB stores only a bcrypt hash; `tempPassword` never appears in `OperationLog`
- [ ] new user can log in with the temp password and sees only their role's menu

### S2 — List & find users
*As an admin, I see all users with role/status/warehouse and can search.*
- [ ] paginated, keyword matches name/email, filters for role/isActive/warehouseId
- [ ] WAREHOUSE_ADMIN sees only users whose `warehouseId` equals their own (no cross-warehouse visibility)
- [ ] `passwordHash` never serialised in any response

### S3 — Edit a user
*As an admin, I change name/role/warehouse when someone changes job.*
- [ ] email change re-checks uniqueness
- [ ] an admin **cannot change their own role** (prevents accidental self-demotion from the only admin seat)
- [ ] audit row with before/after (minus hash)

### S4 — Deactivate / reactivate
*As an admin, I disable a leaver instantly and can undo.*
- [ ] deactivated user: login → 401 (same message as bad password); existing token → 401 on next call
- [ ] **cannot deactivate yourself**; **cannot deactivate the last active SUPER_ADMIN** (400 with explicit reason)
- [ ] rows are never deleted — audit integrity

### S5 — Reset password
*As an admin, I issue a new temp password without ever seeing the old one.*
- [ ] server-generated, returned once, stored hashed; old password stops working immediately
- [ ] audit row records that a reset happened, not the value

### S6 — Track last login
- [ ] `lastLoginAt` updated on successful login (the only write on the login path, documented so the read-only smoke stays honest about it)

### Edge cases & constraints
- Email uniqueness is enforced by the existing `@unique` — treat `P2002` as 409, not 500.
- Role enum is Prisma `Role`; DTO uses `@IsIn` against the same list so the API never accepts a role the guard doesn't know.
- The seed admin keeps working unchanged (`isActive` defaults true).
- `CUSTOMER` role users are creatable but **customer-portal linkage (`User.customerId`) is out of scope**.

## 8. Out of scope

- Self-service registration / forgot-password email flow (no mail infrastructure; admin reset covers it)
- Forced password change on first login (desirable; needs a `mustChangePassword` flag + frontend interstitial — follow-up, not a blocker for C3)
- Per-user permission overrides beyond the 6 roles; multi-warehouse membership (one `warehouseId` only — D4)
- SSO / 2FA
- Deleting users (deliberately — audit integrity)

## 9. Dependencies & risks

| Risk | Mitigation |
|---|---|
| DDL on the shared, previously-unbacked-up DB | Backup + verified restore exist as of 2026-11-02; DDL is additive and idempotent |
| Admin locks themselves out | self-deactivate + last-admin guards, both E2E-tested |
| Temp password leaks via logs | returned once in the HTTP body only; excluded from audit; never logged |
| Deactivation doesn't bite because JWT is stateless | guard re-reads `isActive` per request (one indexed PK lookup) |
| WAREHOUSE_ADMIN sees other warehouses' staff | list filter applied server-side from the token's `warehouseId`, not from a query param |

## 10. Open questions

- Should WAREHOUSE_ADMIN be allowed to *create* OPERATORs for their own warehouse? (Default here: **no** — SUPER_ADMIN only for all writes; revisit after pilot.)
- Temp-password policy: 12 chars alnum is the default; confirm with the owner whether staff can handle symbols.
