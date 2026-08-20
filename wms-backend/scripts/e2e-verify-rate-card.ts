import 'reflect-metadata';
import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { RateCardsService } from '../src/rate-cards/rate-cards.service';
import { OperationLogService } from '../src/common/operation-log.service';
import { FeeService } from '../src/fee/fee.service';

// E2E verification of the Rate Card system (report v4.32).
//
// Replaces the hardcoded 3-value rateMatrix in fee.service.ts:32 with real,
// temporally-dated, per-customer price lists.
//
// ⚠ EVERY PRICE IN THIS FILE IS SYNTHETIC (7 / 11 / 13 / 3 / 29 …).
// Real commercial rates must never enter the repo — not in seeds, not in
// fixtures, not in tests. This file is committed; the price card is not.
//
// Runs on its own fixture customer (CUST-RATE-E2E) and its own cards (RC-E2E-*),
// all torn down at the end, so nothing here touches live pricing.
//
// Headline assertions requested:
//   ① cross-tier validation  — gaps / overlaps / no-zero-start / no-open-end / inverted
//   ② priority lookup        — highest priority wins, then default, respecting dates

const CUST_CODE = 'CUST-RATE-E2E';
const TAG = 'RC-E2E';

const DAY = 24 * 60 * 60 * 1000;

async function wipe(prisma: PrismaService) {
  const cards = await prisma.rateCard.findMany({
    where: { name: { startsWith: TAG } }, select: { id: true },
  });
  const ids = cards.map((c) => c.id);
  if (ids.length) {
    // items / zones / customer links all cascade on RateCard delete.
    await prisma.rateCard.deleteMany({ where: { id: { in: ids } } });
    await prisma.operationLog.deleteMany({
      where: { entityType: 'RateCard', entityId: { in: ids } },
    });
  }
  return ids.length;
}

async function expectErr(fn: () => Promise<any>): Promise<string | null> {
  try { await fn(); return null; } catch (e: any) { return e?.message ?? 'error'; }
}

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();

  const cust = await prisma.customer.upsert({
    where: { code: CUST_CODE }, update: {},
    create: { code: CUST_CODE, name: 'Rate Card E2E Customer', balance: 0 },
  });
  await wipe(prisma);

  const svc = new RateCardsService(prisma, new OperationLogService(prisma));
  const checks: Array<[string, boolean]> = [];
  const push = (n: string, ok: boolean) => checks.push([n, ok]);
  const has = (msg: string | null, frag: string) => !!msg && msg.includes(frag);

  const now = new Date();
  const past = new Date(now.getTime() - 30 * DAY).toISOString();
  const future = new Date(now.getTime() + 30 * DAY).toISOString();
  const afterFuture = new Date(now.getTime() + 31 * DAY).toISOString();

  const draft = (name: string, extra: any = {}) =>
    svc.create({ name: `${TAG} ${name}`, type: 'FULFILLMENT', effectiveAt: past, ...extra });

  const kg = (start: number | undefined, end: number | undefined, price: number) => ({
    tierBasis: 'WEIGHT_KG', rangeStart: start, rangeEnd: end,
    chargeUnit: 'PER_ORDER', unitPrice: price,
  });

  // ═══ ① Cross-tier validation ═══════════════════════════════════════
  // Every one of these is a bug that stays silent until a real parcel hits it.

  const gap = await draft('gap', { items: [kg(0, 10, 7), kg(20, undefined, 11)] });
  const eGap = await expectErr(() => svc.activate(gap.id));
  push('tier: a GAP between bands is rejected', has(eGap, '不连续'));

  const overlap = await draft('overlap', { items: [kg(0, 10, 7), kg(5, undefined, 11)] });
  const eOverlap = await expectErr(() => svc.activate(overlap.id));
  push('tier: OVERLAPPING bands are rejected', has(eOverlap, '重叠'));

  const nonZero = await draft('nonzero', { items: [kg(5, undefined, 7)] });
  const eNonZero = await expectErr(() => svc.activate(nonZero.id));
  push('tier: bands not starting at 0 are rejected', has(eNonZero, '未从 0 开始'));

  const closed = await draft('closed', { items: [kg(0, 10, 7), kg(10, 20, 11)] });
  const eClosed = await expectErr(() => svc.activate(closed.id));
  push('tier: a CLOSED top band is rejected (nothing prices >20)', has(eClosed, '必须开口'));

  const inverted = await draft('inverted', { items: [kg(10, 5, 7)] });
  const eInverted = await expectErr(() => svc.activate(inverted.id));
  push('tier: an inverted band (start ≥ end) is rejected', has(eInverted, '区间无效'));

  const empty = await draft('empty');
  const eEmpty = await expectErr(() => svc.activate(empty.id));
  push('tier: a card with no items cannot be activated', has(eEmpty, '没有任何明细'));

  // Bands on DIFFERENT axes must not be compared with each other: two zones each
  // running 0→∞ is correct, not an overlap.
  const twoAxis = await svc.create({
    name: `${TAG} two-axis`, type: 'FULFILLMENT', effectiveAt: past,
    items: [
      { ...kg(0, 10, 7), itemCode: 'IN' }, { ...kg(10, undefined, 11), itemCode: 'IN' },
      { ...kg(0, 10, 3), itemCode: 'OUT' }, { ...kg(10, undefined, 5), itemCode: 'OUT' },
    ],
  });
  const eTwoAxis = await expectErr(() => svc.activate(twoAxis.id));
  push('tier: bands are grouped per (itemCode, zone, basis), not globally', eTwoAxis === null);

  // The good card — 3 continuous bands, open at the top.
  const good = await draft('tiers', {
    items: [kg(0, 10, 7), kg(10, 30, 11), kg(30, undefined, 29)],
  });
  await svc.activate(good.id);
  await svc.assign({ customerId: cust.id, rateCardId: good.id, priority: 5 });
  push('tier: a continuous 0→∞ run activates', (await svc.findOne(good.id)).status === 'ACTIVE');

  // ─── Boundary behaviour: start inclusive, end exclusive ─────────────
  const q = (value: number) => svc.quote({ customerId: cust.id, type: 'FULFILLMENT', value });

  push('match: 0 → first band (start is inclusive)', (await q(0)).unitPrice === 7);
  push('match: 9.999 → first band', (await q(9.999)).unitPrice === 7);
  push('match: exactly 10 → SECOND band (end is exclusive)', (await q(10)).unitPrice === 11);
  push('match: 29.999 → second band', (await q(29.999)).unitPrice === 11);
  push('match: exactly 30 → third band', (await q(30)).unitPrice === 29);
  push('match: 99999 → open-ended top band', (await q(99999)).unitPrice === 29);

  const eNoValue = await expectErr(() =>
    svc.quote({ customerId: cust.id, type: 'FULFILLMENT' }),
  );
  push('match: a tiered card refuses to quote without a value', has(eNoValue, '必须提供计费数值'));

  // ═══ ② Priority lookup ═════════════════════════════════════════════
  // Four EXTRA cards, deliberately all valid at once, to prove the resolution
  // ORDER rather than merely that a lookup succeeds.

  const svcItem = (price: number) => ({
    items: [{ itemCode: 'E2E_SVC', itemName: '测试服务', chargeUnit: 'PER_ITEM', unitPrice: price }],
  });
  const mk = async (name: string, price: number, extra: any = {}) => {
    const c = await svc.create({
      name: `${TAG} ${name}`, type: 'EXTRA', effectiveAt: past, ...svcItem(price), ...extra,
    });
    await svc.activate(c.id);
    return c;
  };

  const low = await mk('prio-low', 7);
  const high = await mk('prio-high', 11);
  const later = await mk('prio-future', 13, { effectiveAt: future });
  const dflt = await mk('prio-default', 3, { isDefault: true });

  await svc.assign({ customerId: cust.id, rateCardId: low.id, priority: 0 });
  await svc.assign({ customerId: cust.id, rateCardId: high.id, priority: 10 });
  await svc.assign({ customerId: cust.id, rateCardId: later.id, priority: 99 });

  const qx = (at?: string) =>
    svc.quote({ customerId: cust.id, type: 'EXTRA', itemCode: 'E2E_SVC', at });

  const p1 = await qx();
  push('priority: highest EFFECTIVE priority wins (11, not the p99 future card)', p1.unitPrice === 11);
  push('priority: source reported as CUSTOMER', p1.source === 'CUSTOMER');

  const p2 = await qx(afterFuture);
  push('priority: quoting at a future date picks up the future card (13)', p2.unitPrice === 13);

  await svc.unassign(cust.id, high.id);
  push('priority: unassigning the winner falls to the next (7)', (await qx()).unitPrice === 7);

  await svc.unassign(cust.id, low.id);
  const p3 = await qx();
  push('priority: with no effective assignment, falls back to the DEFAULT card (3)', p3.unitPrice === 3);
  push('priority: source reported as DEFAULT', p3.source === 'DEFAULT');
  push('priority: the p99 card is still assigned but not yet effective',
    (await qx(afterFuture)).unitPrice === 13);

  const noCust = await svc.quote({ type: 'EXTRA', itemCode: 'E2E_SVC' });
  push('priority: an unknown customer still gets the default list price', noCust.unitPrice === 3);

  // ═══ Pricing arithmetic ════════════════════════════════════════════

  const qty = await svc.quote({
    customerId: cust.id, type: 'EXTRA', itemCode: 'E2E_SVC', quantity: 4,
  });
  push('amount: unitPrice × quantity', qty.amount === 12);

  const minFeeCard = await svc.create({
    name: `${TAG} minfee`, type: 'EXTRA', effectiveAt: past,
    items: [{ itemCode: 'E2E_MIN', chargeUnit: 'PER_KG', unitPrice: 2, minFee: 25 }],
  });
  await svc.activate(minFeeCard.id);
  await svc.assign({ customerId: cust.id, rateCardId: minFeeCard.id, priority: 50 });

  const small = await svc.quote({
    customerId: cust.id, type: 'EXTRA', itemCode: 'E2E_MIN', quantity: 3,
  });
  push('amount: minFee floors a small charge (3×2=6 → 25)', small.amount === 25 && small.minFeeApplied === true);

  const big = await svc.quote({
    customerId: cust.id, type: 'EXTRA', itemCode: 'E2E_MIN', quantity: 20,
  });
  push('amount: minFee does NOT inflate a large charge (20×2=40)', big.amount === 40 && big.minFeeApplied === false);

  // ─── 面议 must not bill as zero ──────────────────────────────────────
  const qorCard = await svc.create({
    name: `${TAG} qor`, type: 'EXTRA', effectiveAt: past,
    items: [{ itemCode: 'E2E_QOR', itemName: '面议项', chargeUnit: 'PER_ORDER', quoteOnRequest: true }],
  });
  await svc.activate(qorCard.id);
  await svc.assign({ customerId: cust.id, rateCardId: qorCard.id, priority: 60 });

  const qor = await svc.quote({ customerId: cust.id, type: 'EXTRA', itemCode: 'E2E_QOR' });
  push('面议: amount is NULL, never 0 (a 0 would silently leak revenue)',
    qor.amount === null && qor.unitPrice === null && qor.quoteOnRequest === true);

  const eNoPrice = await expectErr(() => svc.create({
    name: `${TAG} nopricebug`, type: 'EXTRA', effectiveAt: past,
    items: [{ itemCode: 'OOPS', chargeUnit: 'PER_ORDER' }],
  }));
  push('面议: a missing price without the explicit flag is REJECTED', has(eNoPrice, '缺少单价'));

  // ═══ Immutability of ACTIVE cards ══════════════════════════════════

  const eAddToActive = await expectErr(() =>
    svc.addItems(good.id, { items: [kg(0, 5, 99)] }),
  );
  push('frozen: cannot append items to an ACTIVE card', has(eAddToActive, '不允许'));

  const activeItem = (await svc.findOne(good.id)).items[0];
  const eDelActive = await expectErr(() => svc.removeItem(activeItem.id));
  push('frozen: cannot delete an item from an ACTIVE card', has(eDelActive, '不可删除'));

  const eReactivate = await expectErr(() => svc.activate(good.id));
  push('frozen: ACTIVE → ACTIVE is refused by the state machine', has(eReactivate, '不允许转为'));

  await svc.archive(qorCard.id);
  const eUnarchive = await expectErr(() => svc.activate(qorCard.id));
  push('frozen: ARCHIVED is terminal', has(eUnarchive, '不允许转为'));

  const eAssignArchived = await expectErr(() =>
    svc.assign({ customerId: cust.id, rateCardId: qorCard.id }),
  );
  push('frozen: an ARCHIVED card cannot be assigned to a customer', has(eAssignArchived, '已归档'));

  // DRAFT cards, by contrast, are freely editable.
  const editable = await draft('editable', { items: [kg(0, undefined, 7)] });
  await svc.addItems(editable.id, { items: [{ itemCode: 'X', chargeUnit: 'PER_ITEM', unitPrice: 1 }] });
  push('draft: a DRAFT card still accepts new items', (await svc.findOne(editable.id)).items.length === 2);

  // ═══ SHIPPING: postcode → zone → band ══════════════════════════════

  const eNoCarrier = await expectErr(() => svc.create({
    name: `${TAG} nocarrier`, type: 'SHIPPING', effectiveAt: past,
  }));
  push('shipping: a SHIPPING card without a carrier is rejected', has(eNoCarrier, '必须指定承运商'));

  const shipNoZone = await svc.create({
    name: `${TAG} ship-nozone`, type: 'SHIPPING', carrier: 'E2E-EXPRESS', effectiveAt: past,
    items: [{ ...kg(0, undefined, 7), zone: 'Z1' }],
  });
  const eNoZone = await expectErr(() => svc.activate(shipNoZone.id));
  push('shipping: cannot activate without a zone table', has(eNoZone, '未配置任何分区'));

  const ship = await svc.create({
    name: `${TAG} ship`, type: 'SHIPPING', carrier: 'E2E-EXPRESS', effectiveAt: past,
    items: [
      { ...kg(0, 5, 7), zone: 'Z1' }, { ...kg(5, undefined, 11), zone: 'Z1' },
      { ...kg(0, 5, 13), zone: 'Z2' }, { ...kg(5, undefined, 17), zone: 'Z2' },
      { ...kg(0, 5, 19), zone: 'Z3' }, { ...kg(5, undefined, 23), zone: 'Z3' },
    ],
    zones: [
      { destination: 'V', zone: 'Z1' },
      { destination: 'V6', zone: 'Z2' },
      { destination: 'V6B', zone: 'Z3' },
    ],
  });
  await svc.activate(ship.id);
  await svc.assign({ customerId: cust.id, rateCardId: ship.id, priority: 1 });

  const qs = (destination: string, value: number) =>
    svc.quote({ customerId: cust.id, type: 'SHIPPING', carrier: 'E2E-EXPRESS', destination, value });

  const z3 = await qs('v6b 1a1', 2);
  push('shipping: LONGEST prefix wins (V6B → Z3, not V6 or V)', z3.zone === 'Z3' && z3.unitPrice === 19);
  push('shipping: postcode is normalised (lowercase + spaces stripped)', z3.zone === 'Z3');
  push('shipping: V6C → Z2 (falls back one prefix)', (await qs('V6C', 2)).zone === 'Z2');
  push('shipping: V5X → Z1 (falls back two)', (await qs('V5X', 2)).zone === 'Z1');
  push('shipping: zone AND weight both apply (Z2 @ 9kg → 17)', (await qs('V6C', 9)).unitPrice === 17);

  const eUnknownDest = await expectErr(() => qs('M5V', 2));
  push('shipping: an unmapped postcode is an error, not a guess', has(eUnknownDest, '不在价卡'));

  const eNoDest = await expectErr(() =>
    svc.quote({ customerId: cust.id, type: 'SHIPPING', carrier: 'E2E-EXPRESS', value: 2 }),
  );
  push('shipping: quoting without a destination is refused', has(eNoDest, '必须提供目的地'));

  // Chunked zone import must be re-runnable — real cards carry thousands of rows.
  const reimport = await svc.addZones(shipNoZone.id, {
    zones: [{ destination: 'K1A', zone: 'Z1' }, { destination: 'K1A', zone: 'Z1' }],
  });
  const reimport2 = await svc.addZones(shipNoZone.id, {
    zones: [{ destination: 'K1A', zone: 'Z1' }],
  });
  push('shipping: zone import is idempotent (dupes skipped)',
    reimport.inserted === 1 && reimport2.inserted === 0);

  // ═══ Unresolvable lookups fail loudly ══════════════════════════════

  const eNoCard = await expectErr(() =>
    svc.quote({ customerId: cust.id, type: 'STORAGE', value: 1 }),
  );
  push('lookup: no card of that type → explicit error, not a silent 0', has(eNoCard, '未找到适用的价卡'));

  const eNoItem = await expectErr(() =>
    svc.quote({ customerId: cust.id, type: 'EXTRA', itemCode: 'NOPE' }),
  );
  push('lookup: no matching item → explicit error', has(eNoItem, '没有匹配的计费项'));

  // ═══ Audit ═════════════════════════════════════════════════════════

  const logs = await prisma.operationLog.findMany({
    where: { entityType: 'RateCard', entityId: good.id },
  });
  push('audit: CREATE logged', logs.some((l) => l.action === 'CREATE'));
  push('audit: ACTIVATE logged', logs.some((l) => l.action === 'ACTIVATE'));
  push('audit: ASSIGN logged', logs.some((l) => l.action === 'ASSIGN'));
  push('audit: before/after JSON round-trips (String column, must be parsed)',
    logs.filter((l) => l.action === 'ACTIVATE').every((l) => {
      if (!l.beforeData || !l.afterData) return false;
      return JSON.parse(l.beforeData).status === 'DRAFT'
        && JSON.parse(l.afterData).status === 'ACTIVE';
    }));

  // ═══ FeeService integration ════════════════════════════════════════
  // The whole point of the refactor: POST /fee/calculate must price from a card,
  // not from the hardcoded rateMatrix that used to live in fee.service.ts:32.

  const fee = new FeeService(prisma, svc);
  const prod = await prisma.product.upsert({
    where: { sku: 'SKU-RATE-E2E' }, update: { weight: 2, length: 10, width: 10, height: 10 },
    create: {
      sku: 'SKU-RATE-E2E', name: 'Rate Card E2E Product', customerId: cust.id,
      weight: 2, length: 10, width: 10, height: 10,
    },
  });

  const feeBody = {
    customerId: cust.id, warehouseId: 'n/a',
    items: [{ productId: prod.id, qty: 1 }],
    shippingMode: 'AIR' as const,
  };

  // 2kg actual vs 1000/5000 = 0.2kg volumetric → chargeable 2kg → Z3 band 0–5 → 19
  const feeCard: any = await fee.calculateFee({ ...feeBody, destination: 'V6B 1A1', carrier: 'E2E-EXPRESS' });
  push('fee: chargeable weight = max(actual, volumetric)', feeCard.chargeableWeight === 2);
  push('fee: priced from the RATE CARD, not the matrix',
    feeCard.source === 'RATE_CARD' && feeCard.estimatedFee === 19);
  push('fee: response names the card, zone and band it used',
    feeCard.rateCard?.zone === 'Z3' && feeCard.rateCard?.name === `${TAG} ship`);

  // No destination → cannot reach a zone → placeholder, and it must SAY so.
  const feeFallback: any = await fee.calculateFee(feeBody);
  push('fee: without a postcode it falls back to the placeholder matrix',
    feeFallback.source === 'FALLBACK_MATRIX' && feeFallback.estimatedFee === 11);
  push('fee: the fallback is flagged isEstimate and carries a reason',
    feeFallback.isEstimate === true && !!feeFallback.fallbackReason);
  push('fee: a fallback is never presented as a real quote',
    feeFallback.rateCard === null && feeFallback.details.includes('不可用于对外报价'));

  // An unmapped postcode must degrade loudly, not quietly bill a wrong zone.
  const feeUnmapped: any = await fee.calculateFee({ ...feeBody, destination: 'M5V 2T6', carrier: 'E2E-EXPRESS' });
  push('fee: an unmapped postcode degrades to fallback WITH the reason attached',
    feeUnmapped.source === 'FALLBACK_MATRIX' && feeUnmapped.fallbackReason?.includes('不在价卡'));

  // ═══ Report ════════════════════════════════════════════════════════

  console.log('=== sample ===');
  console.log(JSON.stringify({
    tierBands: [0, 10, 30, 99999].map((v) => ({ value: v, price: null as any })),
    priorityResolution: { withHigh: 11, afterUnassign: 7, fallback: 3, futureDated: 13 },
    shipping: { 'v6b 1a1': z3.zone, unitPrice: z3.unitPrice, amount: z3.amount },
    quoteOnRequest: { amount: qor.amount, message: (qor as any).message },
    minFee: { small: small.amount, large: big.amount },
  }, null, 2));
  console.log('');

  let allOk = true;
  for (const [name, ok] of checks) {
    console.log(`CROSS-CHECK ${name} -> ${ok ? 'PASS' : 'FAIL'}`);
    if (!ok) allOk = false;
  }

  await prisma.product.deleteMany({ where: { sku: 'SKU-RATE-E2E' } });
  const removed = await wipe(prisma);
  const leftover = await prisma.rateCard.count({ where: { name: { startsWith: TAG } } });
  console.log(`\ncleanup: removed ${removed} fixture cards, ${leftover} left behind`);

  await prisma.$disconnect();
  console.log(`${allOk && leftover === 0 ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'} (${checks.length} checks)`);
  process.exit(allOk && leftover === 0 ? 0 : 1);
}

main().catch(async (e) => {
  console.error('VERIFY ERROR:', e?.message ?? e);
  process.exit(1);
});
