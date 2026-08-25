// Labels for the rate card system's enum-like String columns.
// Mirrors wms-backend/src/rate-cards/rate-card.constants.ts — keep in sync.

export const TYPE_LABEL: Record<string, string> = {
  STORAGE: '仓储',
  FULFILLMENT: '操作',
  SHIPPING: '运费',
  EXTRA: '增值',
};

export const TYPE_COLOR: Record<string, string> = {
  STORAGE: 'blue',
  FULFILLMENT: 'green',
  SHIPPING: 'purple',
  EXTRA: 'orange',
};

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: '草稿',
  ACTIVE: '已启用',
  ARCHIVED: '已归档',
};

export const STATUS_COLOR: Record<string, string> = {
  DRAFT: 'default',
  ACTIVE: 'success',
  ARCHIVED: 'warning',
};

export const CHARGE_UNIT_LABEL: Record<string, string> = {
  PER_CBM_DAY: '立方米·天',
  PER_CBM: '立方米',
  PER_KG: '公斤',
  PER_PALLET: '托',
  PER_CARTON: '箱',
  PER_CONTAINER: '柜',
  PER_ORDER: '单',
  PER_ITEM: '件',
  PER_LABEL: '张',
};

export const TIER_BASIS_LABEL: Record<string, string> = {
  NONE: '不分档',
  WEIGHT_KG: '重量 (kg)',
  STORAGE_DAYS: '库龄 (天)',
  VOLUME_CBM: '体积 (CBM)',
  QUANTITY: '数量',
};

// The commercial floor — mirrors MIN_DISCOUNT_RATIO on the backend. The server
// refuses anything below this; the form stops it earlier so the user gets the
// message before a round trip.
export const MIN_DISCOUNT_RATIO = 0.7;
export const MAX_DISCOUNT_RATIO = 1.0;

/** Tier bounds are nullable: null start means 0, null end means unbounded. */
export function bandLabel(start: unknown, end: unknown): string {
  const s = start === null || start === undefined ? 0 : Number(start);
  if (end === null || end === undefined) return `≥ ${trim(s)}`;
  return `${trim(s)} – ${trim(Number(end))}`;
}

/** Bounds are stored at 6dp for lb→kg conversions; trailing zeros help nobody. */
function trim(n: number): string {
  return String(Number(n.toFixed(6)));
}
