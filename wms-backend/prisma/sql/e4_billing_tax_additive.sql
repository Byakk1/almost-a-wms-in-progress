-- E4 Billing + Tax — additive DDL.
--
-- Applied with:  npx prisma db execute --file prisma/sql/e4_billing_tax_additive.sql
-- (Prisma 7 reads the datasource URL from prisma.config.ts; there is no --schema flag.)
--
-- Same policy as box_additive.sql / rate_card_additive.sql: hand-applied additive
-- DDL only, idempotent (re-run = no-op), no `prisma migrate`, no `db push`, no
-- ALTER TYPE, no DROP. A backup was taken immediately before applying this file
-- (scripts/backup-db.sh → E:\wms-backups).
--
-- Mirrors the schema.prisma additions: models TaxRate + Surcharge, and nullable
-- columns on CustomerBill / BillItem. Follows Prisma's DDL naming conventions so a
-- future baseline diff comes out empty.

-- ─── TaxRate: one row per (country, jurisdiction, taxType, effective window) ───
-- Rates are public law (safe in the repo). Resolution is by (countryCode,
-- jurisdiction); the window is resolved at PERIOD END, same as rate cards.
CREATE TABLE IF NOT EXISTS "TaxRate" (
    "id"            TEXT NOT NULL,
    "countryCode"   TEXT NOT NULL,
    "jurisdiction"  TEXT NOT NULL,
    "taxType"       TEXT NOT NULL,
    "ratePercent"   DECIMAL(6,3) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo"   TIMESTAMP(3),
    "isActive"      BOOLEAN NOT NULL DEFAULT true,
    "note"          TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxRate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "TaxRate_countryCode_jurisdiction_taxType_effectiveFrom_key"
    ON "TaxRate"("countryCode", "jurisdiction", "taxType", "effectiveFrom");

-- ─── Surcharge: FLAT / PERCENT_OF_BASE / PASS_THROUGH definitions ─────────────
-- Values for NEW surcharges are commercial data and enter via the admin UI or a
-- future import script — never via this committed file (except the seeded FUEL
-- row below, which carries no amount: PASS_THROUGH is priced by the carrier bill).
CREATE TABLE IF NOT EXISTS "Surcharge" (
    "id"            TEXT NOT NULL,
    "code"          TEXT NOT NULL,
    "name"          TEXT NOT NULL,
    "calcType"      TEXT NOT NULL,
    "value"         DECIMAL(12,4),
    "taxable"       BOOLEAN NOT NULL DEFAULT true,
    "carrier"       TEXT,
    "appliesTo"     TEXT NOT NULL DEFAULT 'ALL',
    "note"          TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo"   TIMESTAMP(3),
    "isActive"      BOOLEAN NOT NULL DEFAULT true,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Surcharge_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Surcharge_code_key" ON "Surcharge"("code");

-- ─── CustomerBill: provisional lifecycle + invoice compliance snapshot ────────
ALTER TABLE "CustomerBill" ADD COLUMN IF NOT EXISTS "isProvisional" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CustomerBill" ADD COLUMN IF NOT EXISTS "warnings" JSONB;
ALTER TABLE "CustomerBill" ADD COLUMN IF NOT EXISTS "taxRegistrationNo" TEXT;
ALTER TABLE "CustomerBill" ADD COLUMN IF NOT EXISTS "finalizedAt" TIMESTAMP(3);

-- ─── BillItem: line kind + per-line pending flag ──────────────────────────────
-- kind ∈ BASE | SURCHARGE | TAX | UNPRICED ; NULL on pre-E4 rows, read as BASE.
ALTER TABLE "BillItem" ADD COLUMN IF NOT EXISTS "kind" TEXT;
ALTER TABLE "BillItem" ADD COLUMN IF NOT EXISTS "isProvisional" BOOLEAN NOT NULL DEFAULT false;

-- ─── Seed: Canadian GST/HST/PST/QST (public law; verify with accountant) ──────
-- Rates current as of 2026-11. History is simplified to the current structure:
-- NS carries a second row because the 15%→14% cut (2025-04-01) falls inside the
-- range of plausible billing months. BC's 2010–2013 HST interlude and pre-2013
-- PST gaps are NOT modelled. effectiveFrom values for long-stable rates use
-- 2008-01-01 (last federal GST change) so any order resolves to current rates.
--
-- ⚠ Windows are HALF-OPEN [effectiveFrom, effectiveTo): effectiveTo is the FIRST
-- instant the row no longer applies. Bills resolve rates at the period-end instant
-- (the last millisecond of the month), so a row end-dated 2025-04-01 still prices
-- ALL of March. The original '2025-03-31' end-date fell short of that instant —
-- a whole month with no NS rate — and was caught by the adversarial E4 tax audit.
INSERT INTO "TaxRate" ("id","countryCode","jurisdiction","taxType","ratePercent","effectiveFrom","effectiveTo","isActive","note","createdAt","updatedAt") VALUES
  ('TR-CA-ON-HST',  'CA','ON','HST', 13.000,'2010-07-01',NULL,true,'ON 合并 13%',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('TR-CA-NS-HST-15','CA','NS','HST',15.000,'2010-07-01','2025-04-01',true,'NS 2025-04-01 起降至 14%（本行覆盖 3 月整月）',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('TR-CA-NS-HST-14','CA','NS','HST',14.000,'2025-04-01',NULL,true,'NS 降税后',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('TR-CA-NB-HST',  'CA','NB','HST', 15.000,'2016-07-01',NULL,true,'',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('TR-CA-NL-HST',  'CA','NL','HST', 15.000,'2016-07-01',NULL,true,'',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('TR-CA-PE-HST',  'CA','PE','HST', 15.000,'2013-04-01',NULL,true,'',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('TR-CA-QC-GST',  'CA','QC','GST',  5.000,'2008-01-01',NULL,true,'',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('TR-CA-QC-QST',  'CA','QC','QST',  9.975,'2013-01-01',NULL,true,'2013 起与 GST 并列（不再复利）',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('TR-CA-AB-GST',  'CA','AB','GST',  5.000,'2008-01-01',NULL,true,'阿省无省税',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('TR-CA-SK-GST',  'CA','SK','GST',  5.000,'2008-01-01',NULL,true,'',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('TR-CA-SK-PST',  'CA','SK','PST',  6.000,'2017-06-01',NULL,true,'',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('TR-CA-MB-GST',  'CA','MB','GST',  5.000,'2008-01-01',NULL,true,'',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('TR-CA-MB-PST',  'CA','MB','PST',  7.000,'2013-07-01',NULL,true,'',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('TR-CA-BC-GST',  'CA','BC','GST',  5.000,'2013-04-01',NULL,true,'',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('TR-CA-BC-PST',  'CA','BC','PST',  7.000,'2013-04-01',NULL,true,'',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('TR-CA-NT-GST',  'CA','NT','GST',  5.000,'2008-01-01',NULL,true,'',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('TR-CA-NU-GST',  'CA','NU','GST',  5.000,'2008-01-01',NULL,true,'',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('TR-CA-YT-GST',  'CA','YT','GST',  5.000,'2008-01-01',NULL,true,'',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("countryCode","jurisdiction","taxType","effectiveFrom") DO NOTHING;

-- ─── Fix-up (idempotent): re-align databases seeded before the convention ─────
-- The INSERT above is DO NOTHING on conflict, so already-seeded rows keep their
-- old value; this corrects exactly the known boundary row and no-ops afterwards.
UPDATE "TaxRate" SET "effectiveTo" = '2025-04-01'
WHERE "id" = 'TR-CA-NS-HST-15' AND "effectiveTo" = '2025-03-31';
-- Decision 2026-11-02: non-CA destinations are 0% export, flagged for manual
-- review (the bill stays provisional until finalize confirms EXPORT_ZERO_RATED).
-- Modelled as data, not code, so the accountant can change any country without
-- a deploy.
INSERT INTO "TaxRate" ("id","countryCode","jurisdiction","taxType","ratePercent","effectiveFrom","effectiveTo","isActive","note","createdAt","updatedAt") VALUES
  ('TR-AU-EXPORT','AU','AU','EXPORT',0.000,'2023-01-01',NULL,true,'出口零税率，待人工复核',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('TR-NZ-EXPORT','NZ','NZ','EXPORT',0.000,'2023-01-01',NULL,true,'出口零税率，待人工复核',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
  ('TR-US-EXPORT','US','US','EXPORT',0.000,'2023-01-01',NULL,true,'出口零税率，待人工复核',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("countryCode","jurisdiction","taxType","effectiveFrom") DO NOTHING;

-- ─── Seed: FUEL pass-through (the only launch surcharge, per decision) ────────
-- PASS_THROUGH carries no value by design: the amount arrives on the carrier's
-- bill and is entered at finalize. A missing amount stays null and keeps the
-- bill provisional — it must NEVER default to 0.
INSERT INTO "Surcharge" ("id","code","name","calcType","value","taxable","carrier","appliesTo","note","effectiveFrom","effectiveTo","isActive","createdAt","updatedAt") VALUES
  ('SC-FUEL','FUEL','燃油附加费','PASS_THROUGH',NULL,true,NULL,'SHIPPING','实报实销：金额以承运商账单为准，收到后在 finalize 时录入', '2023-01-01',NULL,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;
