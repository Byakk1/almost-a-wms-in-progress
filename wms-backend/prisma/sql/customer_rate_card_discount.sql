-- CustomerRateCard.discountRatio — additive DDL.
--
-- Applied with:  npx prisma db execute --file prisma/sql/customer_rate_card_discount.sql
--
-- Contract pricing: a customer may be assigned a card at a negotiated multiplier
-- between 0.70 and 1.00 (i.e. at most 30% off). 1.000 = list price.
--
-- The 0.70 floor is enforced in THREE places on purpose:
--   · the DTO           (@Min(0.7)/@Max(1)) — rejects the bad request early
--   · the service       — covers callers that bypass the controller (scripts, jobs)
--   · this CHECK        — covers everything, including hand-written SQL
-- A commercial floor that lives only in application code is one migration script
-- away from being silently violated, and an under-floor rate is money already lost
-- by the time anyone notices.
--
-- Safe to run: CustomerRateCard held 0 rows at the time of writing (verified), so
-- the column default and the CHECK cannot conflict with existing data.

-- AddColumn
ALTER TABLE "CustomerRateCard"
    ADD COLUMN IF NOT EXISTS "discountRatio" DECIMAL(4,3) NOT NULL DEFAULT 1.000;

-- AddConstraint (Postgres has no ADD CONSTRAINT IF NOT EXISTS)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CustomerRateCard_discountRatio_range') THEN
    ALTER TABLE "CustomerRateCard"
      ADD CONSTRAINT "CustomerRateCard_discountRatio_range"
      CHECK ("discountRatio" >= 0.700 AND "discountRatio" <= 1.000);
  END IF;
END $$;
