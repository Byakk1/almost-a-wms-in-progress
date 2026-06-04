-- Manual additive DDL for Wave + WaveOrder (Sprint 5 item 3: wave management 波次).
-- Apply: npx prisma db execute --file prisma/_add-wave.sql --schema prisma/schema.prisma
--
-- Why manual (not `prisma migrate`): the migration history in prisma/migrations is stale
-- (OutboundAllocation / InventoryTransaction / PutawayRule exist in the DB via `db push`/`db execute`
-- but in no migration), so `migrate dev` would see drift and could reset the shared Supabase DB.
-- This script is purely ADDITIVE (two new tables + indexes + FKs), idempotent, and matches
-- Prisma's generated DDL exactly. Reference: prisma/_add-putaway-rule.sql.

-- CreateTable: Wave
CREATE TABLE IF NOT EXISTS "Wave" (
    "id" TEXT NOT NULL,
    "waveNo" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "strategy" TEXT NOT NULL DEFAULT 'PICK_AND_PASS',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wave_pkey" PRIMARY KEY ("id")
);

-- CreateTable: WaveOrder
CREATE TABLE IF NOT EXISTS "WaveOrder" (
    "id" TEXT NOT NULL,
    "waveId" TEXT NOT NULL,
    "outboundOrderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaveOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Wave_waveNo_key" ON "Wave"("waveNo");
CREATE INDEX IF NOT EXISTS "Wave_warehouseId_status_idx" ON "Wave"("warehouseId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "WaveOrder_waveId_outboundOrderId_key" ON "WaveOrder"("waveId", "outboundOrderId");
CREATE INDEX IF NOT EXISTS "WaveOrder_outboundOrderId_idx" ON "WaveOrder"("outboundOrderId");

-- AddForeignKey (guarded so the script is safe to re-run)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Wave_warehouseId_fkey') THEN
    ALTER TABLE "Wave" ADD CONSTRAINT "Wave_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WaveOrder_waveId_fkey') THEN
    ALTER TABLE "WaveOrder" ADD CONSTRAINT "WaveOrder_waveId_fkey" FOREIGN KEY ("waveId") REFERENCES "Wave"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'WaveOrder_outboundOrderId_fkey') THEN
    ALTER TABLE "WaveOrder" ADD CONSTRAINT "WaveOrder_outboundOrderId_fkey" FOREIGN KEY ("outboundOrderId") REFERENCES "OutboundOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
