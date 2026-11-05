-- User provisioning — additive DDL for E3 (PRD docs/prd/2026-11-02-e3-user-provisioning.md).
--
-- Applied with:  npx prisma db execute --file prisma/sql/user_provisioning_additive.sql
-- Re-entrant: safe to run more than once.
--
-- Why a column instead of deleting rows: OperationLog.operatorId points at User.id.
-- Deleting a departed staff member would orphan the audit trail that proves who did
-- what. Disabling keeps history intact and is reversible when someone returns.
--
-- "isActive" (not "status"): the model needs exactly two states today. A status enum
-- would invite states nothing reads; a boolean cannot drift out of sync with reality.

-- AddColumn: default true so every existing row (the seed admin) stays enabled.
ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AddColumn: last successful login. Nullable — existing rows have never logged in
-- since the column existed, and null is the honest value for "unknown".
ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "lastLoginAt" TIMESTAMP(3);

-- Index: the guard re-reads isActive on every authenticated request, and the admin
-- list filters on it. Partial index — inactive users are the rare case.
CREATE INDEX IF NOT EXISTS "User_isActive_idx" ON "User" ("isActive");
