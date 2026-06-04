-- Manual additive DDL for PutawayRule (Sprint 5 item 2: putaway strategy engine).
-- Apply: npx prisma db execute --file prisma/_add-putaway-rule.sql --schema prisma/schema.prisma
--
-- Why manual (not `prisma migrate`): the migration history in prisma/migrations is stale
-- (OutboundAllocation / InventoryTransaction exist in the DB via `db push` but in no migration),
-- so `migrate dev` would see drift and could reset the shared Supabase DB. This script is purely
-- ADDITIVE (one new table + index + FK), idempotent, and matches Prisma's generated DDL exactly.

-- CreateTable
CREATE TABLE IF NOT EXISTS "PutawayRule" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "productCategory" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PutawayRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "PutawayRule_warehouseId_isActive_priority_idx" ON "PutawayRule"("warehouseId", "isActive", "priority");

-- AddForeignKey (guarded so the script is safe to re-run)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PutawayRule_warehouseId_fkey') THEN
    ALTER TABLE "PutawayRule" ADD CONSTRAINT "PutawayRule_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
