-- ShippingZone.origin — additive DDL.
--
-- Applied with:  npx prisma db execute --file prisma/sql/shipping_zone_origin.sql
--
-- WHY: the real Canada Post / Intelcom / Purolator zone tables map ONE postcode to
-- DIFFERENT zones depending on which warehouse ships it — the sheet carries a
-- 多伦多 column and a 温哥华 column side by side. The original unique constraint
-- (rateCardId, destination) can physically hold only one of them, so importing the
-- real zone table would have silently dropped every second origin.
--
-- Safe to run: at the time of writing ShippingZone holds 0 rows (verified), so the
-- ADD COLUMN and the index swap cannot lose data. The column is NOT NULL DEFAULT ''
-- rather than nullable BECAUSE Postgres treats NULLs in a unique index as distinct
-- — a nullable origin would let the same (card, destination) be inserted repeatedly
-- and defeat the deduplication the import relies on.

-- AddColumn
ALTER TABLE "ShippingZone" ADD COLUMN IF NOT EXISTS "origin" TEXT NOT NULL DEFAULT '';

-- Swap the unique index to include origin.
DROP INDEX IF EXISTS "ShippingZone_rateCardId_destination_key";
CREATE UNIQUE INDEX IF NOT EXISTS "ShippingZone_rateCardId_origin_destination_key"
    ON "ShippingZone"("rateCardId", "origin", "destination");

-- Lookup path is (card, origin, destination-prefix); the old (rateCardId, zone)
-- index stays for listing a card's zones by zone code.
CREATE INDEX IF NOT EXISTS "ShippingZone_rateCardId_origin_idx"
    ON "ShippingZone"("rateCardId", "origin");
