import 'reflect-metadata';
import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { BillsService } from '../src/bills/bills.service';
import { RateCardsService } from '../src/rate-cards/rate-cards.service';
import { OperationLogService } from '../src/common/operation-log.service';

// E2E verification of monthly billing (report v4.37).
//
// Replaces the previous implementation's Math.random() bill number and three
// hardcoded amounts (500 / 150.5 / 850.75) presented as a finished invoice.
//
// ⚠ EVERY PRICE IN THIS FILE IS SYNTHETIC. Real rates never enter the repo.
//
// Runs on its own fixture — customer CUST-BILL-E2E, warehouse WH-BILL-E2E, its
// own rate cards (BILL-E2E-*) and its own orders — so no real customer balance,
// order or price list is touched. The live DB has 1 shipped order and 2 receipts
// in total, so a meaningful bill cannot be built from existing data anyway.

const CUST = 'CUST-BILL-E2E';
const WH = 'WH-BILL-E2E';
const TAG = 'BILL-E2E';
const PERIOD = '2026-04';

// Inside the period, so the window filter is actually exercised.
const IN = new Date(Date.UTC(2026, 3, 15));
const OUT_OF_WINDOW = new Date(Date.UTC(2026, 2, 15)); // March — must be excluded

async function wipe(prisma: PrismaService, custId: string) {
  const bills = await prisma.customerBill.findMany({ where: { customerId: custId }, select: { id: true } });
  await prisma.customerBill.deleteMany({ where: { customerId: custId } });
  await prisma.operationLog.deleteMany({
    where: { entityType: 'CustomerBill', entityId: { in: bills.map((b) => b.id) } },
  });
  await prisma.customerTransaction.deleteMany({ where: { customerId: custId } });
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

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();

  const cust = await prisma.customer.upsert({
    where: { code: CUST }, update: {},
    create: { code: CUST, name: 'Billing E2E Customer', balance: 0 },
  });
  const wh = await prisma.warehouse.upsert({
    where: { code: WH }, update: {},
    create: { code: WH, name: 'Billing E2E Warehouse' },
  });
  const product = await prisma.product.upsert({
    where: { sku: 'SKU-BILL-E2E' }, update: { weight: 2 },
    create: { sku: 'SKU-BILL-E2E', name: 'Billing E2E Product', customerId: cust.id, weight: 2 },
  });
  await wipe(prisma, cust.id);

  const rc = new RateCardsService(prisma, new OperationLogService(prisma));
  const svc = new BillsService(prisma, rc, new OperationLogService(prisma));
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

  // ─── Fixture events ─────────────────────────────────────────────────
  const mkOrder = async (no: string, over: any = {}) => prisma.outboundOrder.create({
    data: {
      orderNo: no, customerId: cust.id, warehouseId: wh.id, status: 'SHIPPED',
      shippedAt: IN, packageActualWeight: 3, recipientZip: 'V6B 1A1', carrier: 'E2E-BILL-EXP',
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

  const recv = await prisma.receivingOrder.create({
    data: {
      receivingNo: `${TAG}-R1`, customerId: cust.id, warehouseId: wh.id,
      status: 'COMPLETED', updatedAt: IN,
      items: { create: [{ productId: product.id, expectedQty: 5, receivedQty: 5 }] },
    },
  });

  // ─── Generate ───────────────────────────────────────────────────────
  const bill: any = await svc.generateMonthlyBill(cust.id, PERIOD);
  // qty / unitPrice / totalAmount are Decimal columns: compare via Number(),
  // never ===, or every check silently fails against a Decimal instance.
  const line = (t: string) => bill.items.find((i: any) => i.feeType === t);

  push('billNo is sequential per period, not random', bill.billNo === `BILL-202604-0001`);
  push('window: only the 2 in-period shipped orders + the 2 partials are counted',
    bill.sourceEvents.outboundOrders === 4);
  push('window: the March order and the unshipped order are excluded',
    bill.sourceEvents.outboundOrders === 4 && bill.sourceEvents.receivingOrders === 1);

  // 3 orders carry weight (O1, O2, O5) → 3 × 7 = 21
  push('出库操作费: priced per order from the card (3 × 7 = 21)',
    Number(line('OUTBOUND_HANDLING')?.totalAmount) === 21 && Number(line('OUTBOUND_HANDLING')?.qty) === 3);
  // Only O1 and O2 have a postcode → 2 × 11 = 22
  push('基础运费: only orders with a postcode are billed (2 × 11 = 22)',
    Number(line('SHIPPING')?.totalAmount) === 22 && Number(line('SHIPPING')?.qty) === 2);
  // 5 units × 2 kg = 10 kg → 3
  push('入库操作费: priced from received qty × product weight (1 × 3 = 3)',
    Number(line('INBOUND_HANDLING')?.totalAmount) === 3);

  push('total is the sum of the priced lines (21 + 22 + 3 = 46)', Number(bill.amount) === 46);

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

  // ─── The balance actually moves ─────────────────────────────────────
  const after = await prisma.customer.findUniqueOrThrow({ where: { id: cust.id } });
  push('balance: the bill is posted to the customer account (0 → -46)',
    Number(after.balance) === -46 && bill.balanceBefore === 0 && bill.balanceAfter === -46);

  const ledger = await prisma.customerTransaction.findMany({ where: { customerId: cust.id } });
  push('balance: one deduction row on the ledger, matching the bill',
    ledger.length === 1 && Number(ledger[0].amount) === -46
    && !!ledger[0].description?.includes(bill.billNo));

  // ─── Idempotency ────────────────────────────────────────────────────
  const eDup = await expectErr(() => svc.generateMonthlyBill(cust.id, PERIOD));
  push('idempotent: regenerating the same period is refused', has(eDup, '账单已存在'));

  const balanceAfterDup = await prisma.customer.findUniqueOrThrow({ where: { id: cust.id } });
  push('idempotent: the refused re-run did NOT double-charge',
    Number(balanceAfterDup.balance) === -46);

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
    && JSON.parse(logs[0].afterData!).balance === -46);

  // ─── Report ─────────────────────────────────────────────────────────
  console.log('=== sample ===');
  console.log(JSON.stringify({
    billNo: bill.billNo,
    lines: bill.items.map((i: any) => ({ feeType: i.feeType, qty: i.qty, total: Number(i.totalAmount) })),
    total: Number(bill.amount),
    balance: { before: bill.balanceBefore, after: bill.balanceAfter },
    warnings: bill.warnings,
  }, null, 2));
  console.log('');

  let allOk = true;
  for (const [name, ok] of checks) {
    console.log(`CROSS-CHECK ${name} -> ${ok ? 'PASS' : 'FAIL'}`);
    if (!ok) allOk = false;
  }

  await wipe(prisma, cust.id);
  await prisma.$disconnect();
  console.log(`\n${allOk ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'} (${checks.length} checks)`);
  process.exit(allOk ? 0 : 1);
}

main().catch(async (e) => {
  console.error('VERIFY ERROR:', e?.message ?? e);
  process.exit(1);
});
