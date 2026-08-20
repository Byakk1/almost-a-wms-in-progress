/**
 * Allowed values for the Rate Card system's enum-like String columns.
 *
 * These are TEXT in Postgres, not enum types — see prisma/sql/rate_card_additive.sql
 * for why. That means the DB will accept anything, so these lists are the ONLY
 * enforcement: keep every write path behind a DTO that @IsIn(...)s against them.
 */

// ─── Card type ──────────────────────────────────────────────────────

export const RATE_CARD_TYPES = ['STORAGE', 'FULFILLMENT', 'SHIPPING', 'EXTRA'] as const;
export type RateCardType = (typeof RATE_CARD_TYPES)[number];

// ─── Card lifecycle ─────────────────────────────────────────────────

export const RATE_CARD_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;
export type RateCardStatus = (typeof RATE_CARD_STATUSES)[number];

// ─── What a price is charged PER ────────────────────────────────────
// Mixed within a single card on purpose: a fulfillment card prices bands 1–12 as
// a flat PER_ORDER figure and the >100kg tail as PER_KG. chargeUnit therefore
// lives on the item, never on the header.

export const CHARGE_UNITS = [
  'PER_CBM_DAY', // 仓储：立方米·天
  'PER_CBM',
  'PER_KG',
  'PER_PALLET', // 托
  'PER_CARTON', // 箱
  'PER_CONTAINER', // 柜：20GP / 40HQ / 45HQ
  'PER_ORDER', // 单
  'PER_ITEM', // 件
  'PER_LABEL', // 张
] as const;
export type ChargeUnit = (typeof CHARGE_UNITS)[number];

// ─── What rangeStart/rangeEnd MEASURE ───────────────────────────────
// Without this a tier is dimensionless: `0–15` is days for storage but kilograms
// for fulfillment, and nothing else on the row records which.

export const TIER_BASES = [
  'NONE', // flat price, not a tier
  'WEIGHT_KG',
  'STORAGE_DAYS',
  'VOLUME_CBM',
  'QUANTITY',
] as const;
export type TierBasis = (typeof TIER_BASES)[number];
