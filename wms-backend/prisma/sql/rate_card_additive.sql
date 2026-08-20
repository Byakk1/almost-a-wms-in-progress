-- Rate Card system (价卡) — additive DDL.
--
-- Applied with:  npx prisma db execute --file prisma/sql/rate_card_additive.sql
-- (Prisma 7 reads the datasource URL from prisma.config.ts; there is no --schema flag.)
--
-- This project runs on hand-applied additive DDL, NOT `prisma migrate` — the migrations
-- history is stale and `migrate dev` would offer to reset the database, which has no
-- known backup. Keep this file idempotent so a re-run is a no-op rather than an error.
--
-- Four new tables, no ALTER on any existing table: the Customer ↔ RateCard link lives in
-- its own join table, so nothing already holding data is touched.
--
-- Enum-like columns (type / status / chargeUnit / tierBasis) are TEXT, not Postgres enum
-- types, matching the convention of the three most recent models (PutawayRule, Wave, Box).
-- Rationale: ChargeUnit grew from 4 to 9 values during design alone, and `ALTER TYPE ...
-- ADD VALUE` is a poor thing to need on a database with no backup. Allowed values are
-- enforced by class-validator @IsIn(...) in the DTOs — see src/rate-cards/rate-card.constants.ts.

-- CreateTable: RateCard (header — one commercial price list, temporally dated)
CREATE TABLE IF NOT EXISTS "RateCard" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,                              -- STORAGE | FULFILLMENT | SHIPPING | EXTRA
    "carrier" TEXT,                                    -- SHIPPING only: one card per carrier
    "currency" TEXT NOT NULL DEFAULT 'CAD',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,        -- list price when a customer has no assignment
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "expiredAt" TIMESTAMP(3),                          -- NULL = open-ended
    "status" TEXT NOT NULL DEFAULT 'DRAFT',            -- DRAFT | ACTIVE | ARCHIVED
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable: RateCardItem (one priced line — a tier band, or a flat named service)
CREATE TABLE IF NOT EXISTS "RateCardItem" (
    "id" TEXT NOT NULL,
    "rateCardId" TEXT NOT NULL,
    "itemCode" TEXT,                                   -- OUTBOUND_PICK | UNLOAD_40HQ | PHOTO …
    "itemName" TEXT,
    "zone" TEXT,                                       -- SHIPPING only; joins ShippingZone.zone
    "tierBasis" TEXT NOT NULL DEFAULT 'NONE',          -- what rangeStart/rangeEnd MEASURE
    "rangeStart" DECIMAL(12,3),                        -- inclusive; NULL = 0
    "rangeEnd" DECIMAL(12,3),                          -- exclusive; NULL = infinity
    "chargeUnit" TEXT NOT NULL,                        -- PER_CBM_DAY | PER_KG | PER_ORDER …
    "unitPrice" DECIMAL(12,4),                         -- NULL only when quoteOnRequest
    "minFee" DECIMAL(10,2),
    "quoteOnRequest" BOOLEAN NOT NULL DEFAULT false,   -- 面议 / 详细请咨询客服
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateCardItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ShippingZone (postcode → zone; the first of SHIPPING's two lookup steps)
CREATE TABLE IF NOT EXISTS "ShippingZone" (
    "id" TEXT NOT NULL,
    "rateCardId" TEXT NOT NULL,
    "destination" TEXT NOT NULL,                       -- postcode prefix / FSA, longest match wins
    "zone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShippingZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CustomerRateCard (assignment; higher priority wins)
CREATE TABLE IF NOT EXISTS "CustomerRateCard" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "rateCardId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerRateCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "RateCard_type_status_effectiveAt_idx" ON "RateCard"("type", "status", "effectiveAt");
CREATE INDEX IF NOT EXISTS "RateCardItem_rateCardId_tierBasis_rangeStart_idx" ON "RateCardItem"("rateCardId", "tierBasis", "rangeStart");
CREATE INDEX IF NOT EXISTS "RateCardItem_rateCardId_zone_idx" ON "RateCardItem"("rateCardId", "zone");
CREATE INDEX IF NOT EXISTS "RateCardItem_rateCardId_itemCode_idx" ON "RateCardItem"("rateCardId", "itemCode");
CREATE UNIQUE INDEX IF NOT EXISTS "ShippingZone_rateCardId_destination_key" ON "ShippingZone"("rateCardId", "destination");
CREATE INDEX IF NOT EXISTS "ShippingZone_rateCardId_zone_idx" ON "ShippingZone"("rateCardId", "zone");
CREATE UNIQUE INDEX IF NOT EXISTS "CustomerRateCard_customerId_rateCardId_key" ON "CustomerRateCard"("customerId", "rateCardId");
CREATE INDEX IF NOT EXISTS "CustomerRateCard_customerId_priority_idx" ON "CustomerRateCard"("customerId", "priority");

-- AddForeignKey (Postgres has no `ADD CONSTRAINT IF NOT EXISTS`, so guard each one)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'RateCardItem_rateCardId_fkey') THEN
    ALTER TABLE "RateCardItem" ADD CONSTRAINT "RateCardItem_rateCardId_fkey" FOREIGN KEY ("rateCardId") REFERENCES "RateCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ShippingZone_rateCardId_fkey') THEN
    ALTER TABLE "ShippingZone" ADD CONSTRAINT "ShippingZone_rateCardId_fkey" FOREIGN KEY ("rateCardId") REFERENCES "RateCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CustomerRateCard_customerId_fkey') THEN
    ALTER TABLE "CustomerRateCard" ADD CONSTRAINT "CustomerRateCard_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CustomerRateCard_rateCardId_fkey') THEN
    ALTER TABLE "CustomerRateCard" ADD CONSTRAINT "CustomerRateCard_rateCardId_fkey" FOREIGN KEY ("rateCardId") REFERENCES "RateCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
