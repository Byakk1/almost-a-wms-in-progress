-- RateCardItem tier bounds: DECIMAL(12,3) → DECIMAL(12,6).
--
-- Applied with:  npx prisma db execute --file prisma/sql/rate_card_item_precision.sql
--
-- WHY: the Purolator sheet prices in POUNDS and states its kg bands as converted
-- values with twelve decimal places (0.454545454545 = 1 lb). At 3dp both a band's
-- end and the next band's start round to the same figure, so the bands stay
-- contiguous — but the boundary lands ~1 g away from where the carrier put it,
-- and every parcel in that window is billed one band cheap. Six decimals covers
-- the lb→kg conversion exactly.
--
-- Widening a numeric's scale is value-preserving: every existing 3dp value is
-- representable at 6dp, so this cannot lose or alter data. RateCardItem held 93
-- rows (the Group A import) at the time of writing.

ALTER TABLE "RateCardItem" ALTER COLUMN "rangeStart" TYPE DECIMAL(12,6);
ALTER TABLE "RateCardItem" ALTER COLUMN "rangeEnd"   TYPE DECIMAL(12,6);
