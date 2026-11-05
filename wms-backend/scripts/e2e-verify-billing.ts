import 'reflect-metadata';
import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { BillsService } from '../src/bills/bills.service';
import { RateCardsService } from '../src/rate-cards/rate-cards.service';
import { OperationLogService } from '../src/common/operation-log.service';
import { OutboundOrdersService } from '../src/outbound-orders/outbound-orders.service';
import { InventoryTransactionService } from '../src/common/inventory-transaction.service';

// E2E verification of monthly billing (report v4.37; extended for E4 tax +
// surcharges + finalize + mark-paid, report v4.42).
//
// Replaces the previous implementation's Math.random() bill number and three
// hardcoded amounts (500 / 150.5 / 850.75) presented as a finished invoice.
//
// ⚠ EVERY PRICE IN THIS FILE IS SYNTHETIC. Real rates never enter the repo.
//   Tax RATES are public law and are READ from the seeded TaxRate table
//   (ON 13 %, AB 5 %, QC 5 + 9.975 %, AU EXPORT 0 %) — never written here.
//
// Runs on its own fixture — customer CUST-BILL-E2E, warehouse WH-BILL-E2E, its
// own rate cards (BILL-E2E-*) and its own orders — so no real customer balance,
// order or price list is touched. The live DB has 0 timestamped shipped orders,
// so a meaningful bill cannot be built from existing data anyway.
//
// ── Headline assertions ──────────────────────────────────────────────
//   S0  an order shipped through the REAL ship() endpoint carries the timestamp
//       that billing's window filter reads, and appears on the bill for the
//       month it actually shipped in. Nothing in the fixture writes shippedAt
//       for that order — this suite goes red the day ship() stops stamping it
//       (the v4.23 pickedQty lesson: the old masking was "the fixture wrote the
//       column the endpoint never wrote").
//   S2  tax follows the destination: 13 % ON, 5 % AB, GST+QST as TWO lines for
//       QC, 'Quebec' spelled out resolves, AU → explicit EXPORT 0.00 line and a
//       review flag, null province → untaxed and flagged. Never a silent 0 %.
//   S3  fuel (PASS_THROUGH) stays pending → bill provisional; finalize with the
//       carrier actual re-derives tax and posts ONLY the delta, exactly once.
//   S4  mark-paid is allowed while provisional (escrow-style, decision 6); the
//       ledger always sums to the balance across generate → paid → finalize.

const CUST = 'CUST-BILL-E2E';
const WH = 'WH-BILL-E2E';
const TAG = 'BILL-E2E';
const PERIOD = '2026-04';
const PERIOD_B = '2026-06'; // second fixture month for the finalize/paid flow

// Inside the period, so the window filter is actually exercised.
const IN = new Date(Date.UTC(2026, 3, 15));
const IN_B = new Date(Date.UTC(2026, 5, 15));
const OUT_OF_WINDOW = new Date(Date.UTC(2026, 2, 15)); // March — must be excluded

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

async function wipe(prisma: PrismaService, custId: string) {
  const bills = await prisma.customerBill.findMany({ where: { customerId: custId }, select: { id: true } });
  await prisma.customerBill.deleteMany({ where: { customerId: custId } });
  await prisma.operationLog.deleteMany({
    where: { entityType: 'CustomerBill', entityId: { in: bills.map((b) => b.id) } },
  });
  await prisma.customerTransaction.deleteMany({ where: { customerId: custId } });
  const orders = await prisma.outboundOrder.findMany({ where: { customerId: custId }, select: { id: true } });
  await prisma.operationLog.deleteMany({
    where: { entityType: 'OUTBOUND_ORDER', entityId: { in: orders.map((o) => o.id) } },
  });
  await prisma.outboundOrder.deleteMany({ where: { customerId: custId } });
  const recv = await prisma.receivingOrder.findMany({ where: { customerId: custId }, select: { id: true } });
  await prisma.receivingItem.deleteMany({ where: { receivingOrderId: { in: recv.map((r) => r.id) } } });
  await prisma.receivingOrder.deleteMany({ where: { customerId: custId } });
  const cards = await prisma.rateCard.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  await prisma.rateCard.deleteMany({ where: { id: { in: cards.map((c) => c.id) } } });
  await prisma.customer.update({ where: { id: custId }, data: { balance: 0 } });
}

async function expectErr(fn: () => Promise<any>): Promise<string | null> {
  try { await fn(); return null; } catch (e: any) { return e?.message ?? 'error'; }
}
async function expectStatus(fn: () => Promise<any>): Promise<number | null> {
  try { await fn(); return null; } catch (e: any) { return e?.status ?? -1; }
}

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();

  const cust = await prisma.customer.upsert({
    where: { code: CUST }, update: {},
    create: { code: CUST, name: 'Billing E2E Customer', balance: 0 },
  });
  // The warehouse gets a structured address so INBOUND handling can be taxed at
  // the warehouse's province (ON) — the same slash format the real sites use.
  const wh = await prisma.warehouse.upsert({
    where: { code: WH }, update: { address: 'CA/ON/Test//1 Test Rd///M1M1M1' },
    create: { code: WH, name: 'Billing E2E Warehouse', address: 'CA/ON/Test//1 Test Rd///M1M1M1' },
  });
  const product = await prisma.product.upsert({
    where: { sku: 'SKU-BILL-E2E' }, update: { weight: 2 },
    create: { sku: 'SKU-BILL-E2E', name: 'Billing E2E Product', customerId: cust.id, weight: 2 },
  });
  await wipe(prisma, cust.id);

  const opLog = new OperationLogService(prisma);
  const rc = new RateCardsService(prisma, opLog);
  const svc = new BillsService(prisma, rc, opLog);
  const outbound = new OutboundOrdersService(prisma, opLog, new InventoryTransactionService(prisma));
  const checks: Array<[string, boolean]> = [];
  const push = (n: string, ok: boolean) => checks.push([n, ok]);
  const has = (m: string | null, f: string) => !!m && m.includes(f);

  const past = new Date(Date.UTC(2026, 0, 1)).toISOString();

  // ─── Synthetic cards, assigned to the fixture customer ──────────────
  const handling = await rc.create({
    name: `${TAG} handling`, type: 'FULFILLMENT', effectiveAt: past,
    items: [
      { itemCode: 'OUTBOUND_HANDLING', tierBasis: 'WEIGHT_KG', rangeStart: 0, chargeUnit: 'PER_ORDER', unitPrice: 7 },
      { itemCode: 'INBOUND_HANDLING', tierBasis: 'WEIGHT_KG', rangeStart: 0, chargeUnit: 'PER_ORDER', unitPrice: 3 },
    ],
  });
  await rc.activate(handling.id);
  await rc.assign({ customerId: cust.id, rateCardId: handling.id, priority: 10 });

  const freight = await rc.create({
    name: `${TAG} freight`, type: 'SHIPPING', carrier: 'E2E-BILL-EXP', effectiveAt: past,
    items: [{ zone: 'Z1', tierBasis: 'WEIGHT_KG', rangeStart: 0, chargeUnit: 'PER_ORDER', unitPrice: 11 }],
    zones: [{ destination: 'V6B', zone: 'Z1' }],
  });
  await rc.activate(freight.id);
  await rc.assign({ customerId: cust.id, rateCardId: freight.id, priority: 10 });

  // ─── Fixture events (period A: 2026-04, Ontario unless overridden) ──
  const mkOrder = async (no: string, over: any = {}) => prisma.outboundOrder.create({
    data: {
      orderNo: no, customerId: cust.id, warehouseId: wh.id, status: 'SHIPPED',
      shippedAt: IN, packageActualWeight: 3, recipientZip: 'V6B 1A1', carrier: 'E2E-BILL-EXP',
      recipientCountry: 'CA', recipientProvince: 'ON',
      ...over,
    },
  });

  await mkOrder(`${TAG}-O1`);
  await mkOrder(`${TAG}-O2`);
  // Excluded: shipped in March, not April.
  await mkOrder(`${TAG}-O3`, { shippedAt: OUT_OF_WINDOW });
  // Excluded: never shipped.
  await mkOrder(`${TAG}-O4`, { status: 'PENDING', shippedAt: null });
  // Priced for handling but NOT for freight — no postcode.
  await mkOrder(`${TAG}-O5`, { recipientZip: null });
  // No weight at all → neither fee can be computed.
  await mkOrder(`${TAG}-O6`, { packageActualWeight: null, totalWeightKg: null });

  // ─── S0: the REAL ship() endpoint stamps what billing reads ─────────
  // Created PACKED with NO shippedAt — only ship() can set it.
  const o7 = await mkOrder(`${TAG}-O7`, { status: 'PACKED', shippedAt: null });
  await outbound.ship(o7.id);
  const o7After = await prisma.outboundOrder.findUniqueOrThrow({ where: { id: o7.id } });
  push('S0 ship(): the real endpoint stamps shippedAt with the actual date (was NULL before)',
    o7After.status === 'SHIPPED' && o7After.shippedAt !== null
    && (o7After.shippedAt!.getTime() < Date.UTC(2026, 3, 1) || o7After.shippedAt!.getTime() >= Date.UTC(2026, 4, 1)));

  const recv = await prisma.receivingOrder.create({
    data: {
      receivingNo: `${TAG}-R1`, customerId: cust.id, warehouseId: wh.id,
      status: 'COMPLETED', updatedAt: IN,
      items: { create: [{ productId: product.id, expectedQty: 5, receivedQty: 5 }] },
    },
  });

  // ─── Generate period A ──────────────────────────────────────────────
  const bill: any = await svc.generateMonthlyBill(cust.id, PERIOD);
  // qty / unitPrice / totalAmount are Decimal columns: compare via Number(),
  // never ===, or every check silently fails against a Decimal instance.
  const line = (t: string, b: any = bill) => b.items.find((i: any) => i.feeType === t);

  push('billNo is sequential per period, not random', bill.billNo === `BILL-202604-0001`);
  push('S0 window: the really-shipped order carries TODAY\'s stamp, so it is not in the April fixture month (4 events)',
    bill.sourceEvents.outboundOrders === 4);
  push('window: the March order and the unshipped order are excluded (4 outbound + 1 receipt)',
    bill.sourceEvents.outboundOrders === 4 && bill.sourceEvents.receivingOrders === 1);

  // O1, O2, O5 carry weight → 3 × 7 = 21 (O6 is weightless, unpriced)
  push('出库操作费: priced per order from the card (3 × 7 = 21)',
    Number(line('OUTBOUND_HANDLING')?.totalAmount) === 21 && Number(line('OUTBOUND_HANDLING')?.qty) === 3);
  // Only O1 and O2 have a postcode → 2 × 11 = 22
  push('基础运费: only orders with a postcode are billed (2 × 11 = 22)',
    Number(line('SHIPPING')?.totalAmount) === 22 && Number(line('SHIPPING')?.qty) === 2);
  // 5 units × 2 kg = 10 kg → 3
  push('入库操作费: priced from received qty × product weight (1 × 3 = 3)',
    Number(line('INBOUND_HANDLING')?.totalAmount) === 3);

  // ─── Tax (S2): every priced event is Ontario → one HST_ON line at 13 % ─
  // Per-event rounding: O1 (11+7=18 → 2.34), O2 (2.34), O5 (7 → 0.91),
  // R1 receipt (3 → 0.39). Total 5.98 over a taxable base of 46.
  const hst = line('HST_ON');
  push('S2 tax: a single HST_ON line exists for an all-Ontario month', !!hst && hst.kind === 'TAX');
  push('S2 tax: 13 % of the taxable base (2.34+2.34+0.91+0.39 = 5.98 over basis 46)',
    Number(hst?.totalAmount) === 5.98 && Number(hst?.unitPrice) === 46);
  push('S2 tax: the TAX line names type, rate and jurisdiction for filing',
    has(hst?.description, 'HST') && has(hst?.description, '13') && has(hst?.description, 'ON'));
  push('S2 tax: handling is inside the base (ancillary rule) and the receipt is taxed at the WAREHOUSE province',
    Number(hst?.qty) === 4);

  // ─── FUEL (S3): seeded PASS_THROUGH, no actual → pending + provisional ──
  const fuel = line('FUEL');
  push('S3 fuel: a SURCHARGE line exists for the seeded FUEL definition', !!fuel && fuel.kind === 'SURCHARGE');
  push('S3 fuel: pending → amount 0, flagged provisional, never a fabricated figure',
    Number(fuel?.totalAmount) === 0 && fuel?.isProvisional === true && has(fuel?.description, '待录入'));
  push('S3 fuel: counts every priced outbound parcel (3 = O1, O2, O5; receipts are SHIPPING-only)',
    Number(fuel?.qty) === 3);
  push('S3 bill: isProvisional because fuel is pending', bill.isProvisional === true);
  push('S3 bill: the warning names the pending surcharge',
    bill.warnings.some((w: string) => w.includes('FUEL') && w.includes('实报实销')));

  push('total = 21 + 22 + 3 + 5.98 = 51.98 (pending fuel contributes 0)', Number(bill.amount) === 51.98);
  push('items carry kind: BASE / SURCHARGE / TAX / UNPRICED all present',
    ['BASE', 'SURCHARGE', 'TAX', 'UNPRICED'].every((k) => bill.items.some((i: any) => i.kind === k)));
  push('taxRegistrationNo is snapshotted from env (null when unset)',
    bill.taxRegistrationNo === (process.env.BILLING_TAX_REG_NO ?? null));

  // ─── Unpriceable events are surfaced, not dropped ───────────────────
  const un = bill.items.filter((i: any) => i.feeType === 'UNPRICED');
  push('unpriced: the missing-postcode order becomes a zero line, not a silent omission',
    un.some((i: any) => i.description.includes('邮编')));
  push('unpriced: the weightless order is reported too',
    un.some((i: any) => i.description.includes('重量')));
  push('unpriced: zero-amount lines do not inflate the total',
    un.every((i: any) => Number(i.totalAmount) === 0));
  push('unpriced: storage is declared unbilled WITH the reason',
    bill.warnings.some((w: string) => w.includes('仓储费未计入') && w.includes('逐日库存快照')));
  push('unpriced: a wholly-unpriced order (O6) does NOT raise a tax-review flag',
    !bill.warnings.some((w: string) => w.includes('无法识别')));

  // ─── The balance actually moves ─────────────────────────────────────
  const after = await prisma.customer.findUniqueOrThrow({ where: { id: cust.id } });
  push('balance: the bill is posted to the customer account (0 → -51.98)',
    Number(after.balance) === -51.98 && bill.balanceBefore === 0 && bill.balanceAfter === -51.98);

  const ledger = await prisma.customerTransaction.findMany({ where: { customerId: cust.id } });
  push('balance: one deduction row on the ledger, matching the bill',
    ledger.length === 1 && Number(ledger[0].amount) === -51.98
    && !!ledger[0].description?.includes(bill.billNo));

  // ─── Idempotency ────────────────────────────────────────────────────
  const eDup = await expectErr(() => svc.generateMonthlyBill(cust.id, PERIOD));
  push('idempotent: regenerating the same period is refused', has(eDup, '账单已存在'));
  push('idempotent: the refusal is a 409 Conflict, not a 400',
    (await expectStatus(() => svc.generateMonthlyBill(cust.id, PERIOD))) === 409);

  const balanceAfterDup = await prisma.customer.findUniqueOrThrow({ where: { id: cust.id } });
  push('idempotent: the refused re-run did NOT double-charge',
    Number(balanceAfterDup.balance) === -51.98);

  // ─── Sequence survives a deleted middle bill ────────────────────────
  // The old count()+1 scheme regenerated a used number here.
  const may: any = await svc.generateMonthlyBill(cust.id, '2026-05');
  push('sequence: the next period starts its own run', may.billNo === 'BILL-202605-0001');

  const bad = await expectErr(() => svc.generateMonthlyBill(cust.id, '2026-13'));
  push('guard: an impossible month is rejected', has(bad, 'YYYY-MM'));
  const bad2 = await expectErr(() => svc.generateMonthlyBill('nope', PERIOD));
  push('guard: an unknown customer is rejected', has(bad2, '客户不存在'));

  // ─── Audit ──────────────────────────────────────────────────────────
  const logs = await prisma.operationLog.findMany({
    where: { entityType: 'CustomerBill', entityId: bill.id, action: 'GENERATE' },
  });
  push('audit: generation logged with the before/after balance', logs.length === 1
    && JSON.parse(logs[0].beforeData!).balance === 0
    && JSON.parse(logs[0].afterData!).balance === -51.98);

  // ═══ Period B (2026-06): multi-province tax + review flags + finalize + paid ═══
  const mkB = async (no: string, over: any = {}) => mkOrder(no, { shippedAt: IN_B, ...over });
  await mkB(`${TAG}-B-ON`, { recipientProvince: 'Ontario' });            // spelled out → ON
  await mkB(`${TAG}-B-AB`, { recipientProvince: 'AB' });                 // 5 % GST only
  await mkB(`${TAG}-B-QC`, { recipientProvince: 'Quebec' });             // GST 5 + QST 9.975, TWO lines
  await mkB(`${TAG}-B-AU`, { recipientCountry: 'AU', recipientProvince: 'NSW' }); // EXPORT 0 % + review
  await mkB(`${TAG}-B-XX`, { recipientProvince: null });                 // unresolvable → untaxed + review

  const b: any = await svc.generateMonthlyBill(cust.id, PERIOD_B);
  const lb = (t: string) => line(t, b);
  // Each order: freight 11 + handling 7 = 18 taxable.
  push('S2 province: "Ontario" spelled out resolves → HST_ON 13 % of 18 = 2.34',
    Number(lb('HST_ON')?.totalAmount) === 2.34 && Number(lb('HST_ON')?.qty) === 1);
  push('S2 province: AB → GST_AB 5 % of 18 = 0.90 and NO provincial line',
    Number(lb('GST_AB')?.totalAmount) === 0.9 && !b.items.some((i: any) => i.feeType === 'PST_AB'));
  push('S2 province: "Quebec" → TWO lines, GST_QC 0.90 + QST_QC 9.975 % = 1.80',
    Number(lb('GST_QC')?.totalAmount) === 0.9 && Number(lb('QST_QC')?.totalAmount) === 1.8);
  push('S2 export: AU → an EXPLICIT EXPORT_AU line at 0.00 (not an absent line)',
    !!lb('EXPORT_AU') && Number(lb('EXPORT_AU')?.totalAmount) === 0 && lb('EXPORT_AU')?.kind === 'TAX');
  push('S2 export: the EXPORT line is flagged provisional pending review',
    lb('EXPORT_AU')?.isProvisional === true);
  push('S2 export: warning "出口零税率，待人工复核" is raised',
    b.warnings.some((w: string) => w.includes('出口零税率') && w.includes('待人工复核')));
  push('S2 unresolved: a null province yields NO tax line for that order and a warning',
    b.warnings.some((w: string) => w.includes('无法识别') && w.includes('未计税')));
  push('S2 unresolved: the untaxed order is still billed for freight + handling (5 × 18 = 90 base)',
    Number(lb('SHIPPING')?.totalAmount) === 55 && Number(lb('OUTBOUND_HANDLING')?.totalAmount) === 35);
  const taxB = r2(2.34 + 0.9 + 0.9 + 1.8 + 0);
  push(`S2 total: base 90 + tax ${taxB} = ${r2(90 + taxB)} (fuel pending, AU 0, XX untaxed)`,
    Number(b.amount) === r2(90 + taxB));
  push('S3 bill B: provisional (fuel pending + two review flags)', b.isProvisional === true);

  // ─── finalize: refused until everything pending is supplied ─────────
  const balAfterB = Number((await prisma.customer.findUniqueOrThrow({ where: { id: cust.id } })).balance);
  const f0 = await expectErr(() => svc.finalize(b.id));
  push('S3 finalize: with nothing supplied → refused, naming the missing fuel actual AND confirmations',
    has(f0, 'FUEL') && has(f0, 'EXPORT_ZERO_RATED') && has(f0, 'TAX_REVIEW_ACCEPTED'));
  const f1 = await expectErr(() => svc.finalize(b.id, [{ code: 'FUEL', amount: 10 }]));
  push('S3 finalize: fuel alone is not enough while review flags are open',
    has(f1, 'EXPORT_ZERO_RATED') && has(f1, 'TAX_REVIEW_ACCEPTED') && !has(f1, '仍缺实报实销'));
  const f2 = await expectErr(() => svc.finalize(b.id, [], ['EXPORT_ZERO_RATED', 'TAX_REVIEW_ACCEPTED']));
  push('S3 finalize: confirmations alone are not enough while fuel is pending', has(f2, '仍缺实报实销'));
  const balAfterFails = Number((await prisma.customer.findUniqueOrThrow({ where: { id: cust.id } })).balance);
  push('S3 finalize: refused attempts moved NO money', balAfterFails === balAfterB);

  // ─── mark-paid BEFORE finalize (decision 6: allowed while provisional) ──
  const paid: any = await svc.markPaid(b.id);
  push('S4 mark-paid: allowed on a provisional bill → status paid + paidAt',
    paid.status === 'paid' && paid.paidAt !== null && paid.isProvisional === true);
  const balPaid = Number((await prisma.customer.findUniqueOrThrow({ where: { id: cust.id } })).balance);
  push('S4 mark-paid: a payment row restores the balance by the bill amount',
    balPaid === r2(balAfterB + Number(b.amount)));
  push('S4 mark-paid: again → 409', (await expectStatus(() => svc.markPaid(b.id))) === 409);

  // ─── finalize with everything: fuel actual per order + both confirmations ──
  // FUEL actual 10 per shipped order (5 of them) → +50 surcharge, taxable:
  // ON 28 × 13 % = 3.64; AB / QC-GST 28 × 5 % = 1.40 each; QC-QST = 2.79; AU 0.
  const fin: any = await svc.finalize(b.id, [{ code: 'FUEL', amount: 10 }], ['EXPORT_ZERO_RATED', 'TAX_REVIEW_ACCEPTED']);
  const lf = (t: string) => line(t, fin);
  push('S3 finalize: fuel line now carries the actual (5 × 10 = 50) and is no longer provisional',
    Number(lf('FUEL')?.totalAmount) === 50 && lf('FUEL')?.isProvisional === false);
  push('S3 finalize: tax recomputed over base + fuel (HST_ON 28 × 13 % = 3.64)',
    Number(lf('HST_ON')?.totalAmount) === 3.64);
  push('S3 finalize: QST recomputed too (28 × 9.975 % = 2.79)', Number(lf('QST_QC')?.totalAmount) === 2.79);
  push('S3 finalize: EXPORT line stays 0.00 but is no longer provisional after confirmation',
    Number(lf('EXPORT_AU')?.totalAmount) === 0 && lf('EXPORT_AU')?.isProvisional === false);
  push('S3 finalize: bill is final (isProvisional false, finalizedAt set)',
    fin.isProvisional === false && fin.finalizedAt !== null);
  push('S3 finalize: warnings record the confirmations given',
    (fin.warnings as string[]).some((w) => w.includes('已于 finalize 人工确认') && w.includes('EXPORT_ZERO_RATED')));
  const expectedFinal = r2(90 + 50 + 3.64 + r2(28 * 0.05) + r2(28 * 0.05) + 2.79);
  push(`S3 finalize: new total ${expectedFinal} = base 90 + fuel 50 + tax`, Number(fin.amount) === expectedFinal);
  const delta = r2(expectedFinal - Number(b.amount));
  push('S3 finalize: only the DELTA was posted, exactly once', fin.delta === delta
    && (await prisma.customerTransaction.count({ where: { customerId: cust.id, description: { contains: 'finalize' } } })) === 1);
  const balFin = Number((await prisma.customer.findUniqueOrThrow({ where: { id: cust.id } })).balance);
  push('S4 ledger invariant: Σ CustomerTransaction.amount == Customer.balance after generate→paid→finalize',
    r2((await prisma.customerTransaction.findMany({ where: { customerId: cust.id } }))
      .reduce((s, t) => s + Number(t.amount), 0)) === balFin);
  push('S3 finalize: again → refused (no longer provisional)',
    has(await expectErr(() => svc.finalize(b.id, [{ code: 'FUEL', amount: 10 }])), '不是待确认状态'));
  const finLogs = await prisma.operationLog.findMany({ where: { entityType: 'CustomerBill', entityId: b.id } });
  push('audit: GENERATE + MARK_PAID + FINALIZE rows exist for bill B',
    ['GENERATE', 'MARK_PAID', 'FINALIZE'].every((a) => finLogs.some((l) => l.action === a)));

  // ─── List / get ─────────────────────────────────────────────────────
  const all = await svc.listBills({ customerId: cust.id });
  push('list: envelope carries pagination and all 3 fixture bills',
    all.pagination.total === 3 && all.data.length === 3 && all.pagination.page === 1);
  push('list: filter period', (await svc.listBills({ customerId: cust.id, period: PERIOD_B })).pagination.total === 1);
  push('list: filter status=paid', (await svc.listBills({ customerId: cust.id, status: 'paid' })).data.every((x) => x.id === b.id));
  push('list: filter isProvisional=true → only bill A (May has no pending items; B is final)',
    (await svc.listBills({ customerId: cust.id, isProvisional: 'true' })).pagination.total === 1);
  push('list: pageSize honoured', (await svc.listBills({ customerId: cust.id, pageSize: '2' })).data.length === 2);
  const got: any = await svc.getBill(bill.id);
  push('get: returns items + sourceEvents recount', got.items.length === bill.items.length && got.sourceEvents.outboundOrders === 4);
  push('get: unknown id → 404', (await expectStatus(() => svc.getBill('nope'))) === 404);

  // ─── S0 conclusion: the really-shipped order is billed in ITS month ─
  const nowPeriod = o7After.shippedAt!.toISOString().slice(0, 7);
  const nowBill: any = await svc.generateMonthlyBill(cust.id, nowPeriod);
  push(`S0 billing: the order shipped via the real endpoint appears on its own month's bill (${nowPeriod})`,
    nowBill.sourceEvents.outboundOrders === 1
    && Number(line('SHIPPING', nowBill)?.qty) === 1 && Number(line('SHIPPING', nowBill)?.totalAmount) === 11
    && Number(line('OUTBOUND_HANDLING', nowBill)?.qty) === 1);

  // ─── Report ─────────────────────────────────────────────────────────
  console.log('=== sample (period A) ===');
  console.log(JSON.stringify({
    billNo: bill.billNo, isProvisional: bill.isProvisional,
    lines: bill.items.map((i: any) => ({ feeType: i.feeType, kind: i.kind, qty: Number(i.qty), total: Number(i.totalAmount), prov: i.isProvisional })),
    total: Number(bill.amount), warnings: bill.warnings,
  }, null, 2));
  console.log('=== sample (period B, finalized) ===');
  console.log(JSON.stringify({
    billNo: fin.billNo, amount: Number(fin.amount), delta: fin.delta,
    lines: fin.items.map((i: any) => ({ feeType: i.feeType, kind: i.kind, total: Number(i.totalAmount) })),
  }, null, 2));
  console.log('');

  let allOk = true;
  for (const [name, ok] of checks) {
    console.log(`CROSS-CHECK ${name} -> ${ok ? 'PASS' : 'FAIL'}`);
    if (!ok) allOk = false;
  }

  await wipe(prisma, cust.id);
  const residue = await prisma.customerBill.count({ where: { customerId: cust.id } })
    + await prisma.outboundOrder.count({ where: { customerId: cust.id } })
    + await prisma.customerTransaction.count({ where: { customerId: cust.id } });
  const balEnd = Number((await prisma.customer.findUniqueOrThrow({ where: { id: cust.id } })).balance);
  const cleanupOk = residue === 0 && balEnd === 0;
  console.log(`CROSS-CHECK cleanup: 0 fixture rows remain and balance is 0 -> ${cleanupOk ? 'PASS' : 'FAIL'}`);
  if (!cleanupOk) allOk = false;

  await prisma.$disconnect();
  console.log(`\n${allOk ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'} (${checks.length + 1} checks)`);
  process.exit(allOk ? 0 : 1);
}

main().catch(async (e) => {
  console.error('VERIFY ERROR:', e?.message ?? e);
  process.exit(1);
});
