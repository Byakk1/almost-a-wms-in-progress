import 'reflect-metadata';
import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { OutboundOrdersService } from '../src/outbound-orders/outbound-orders.service';
import { OperationLogService } from '../src/common/operation-log.service';
import { InventoryTransactionService } from '../src/common/inventory-transaction.service';

// E2E verification of the FIFO allocation lifecycle + inventory conservation
// (report v4.10 — fills the gap flagged in v4.7 §A / v4.8 §G: "allocate→ship→cancel
//  frozen/available/total 守恒 + InventoryTransaction 副作用 尚无专门 E2E 断言").
//
// Drives the REAL OutboundOrdersService against the live DB on an ISOLATED fixture
// (own warehouse WH-FIFO-E2E) and asserts the invariants the service code promises:
//
//   Scenario 1 — FIFO ordering + allocate + ship (two batches, one SKU):
//     · allocate() drains the OLDER inboundDate batch first (orderBy inboundDate asc)
//     · allocate(): available→frozen, totalQty unchanged          (FREEZE tx, Σ qtyChange = -Q)
//     · ship():     frozen→gone, totalQty decremented, available unchanged (OUTBOUND tx, Σ = -Q)
//     · global invariant totalQty === availableQty + frozenQty holds at every step
//
//   Scenario 2 — allocate → cancel (release path):
//     · cancel() returns frozen→available, totalQty unchanged     (UNFREEZE tx, Σ qtyChange = +Q)
//     · OutboundAllocation ledger rows are deleted (idempotent release)
//     · net inventory movement of a cancelled order === 0 (FREEZE -Q + UNFREEZE +Q)
//
// Re-runnable: warehouse/customer/product are upserted; all dynamic rows
// (orders, inventory, transactions, locations) are wiped before and after the run.

const WH_CODE = 'WH-FIFO-E2E';
const CUST_CODE = 'CUST-FIFO-E2E';
const SKU = 'SKU-FIFO-A';

async function wipeDynamic(prisma: PrismaService, whId: string, custId: string) {
  // Order matters (FK): orders cascade items→allocations; then txns; then inventory; then locations.
  await prisma.outboundOrder.deleteMany({ where: { customerId: custId } });
  await prisma.inventoryTransaction.deleteMany({ where: { warehouseId: whId } });
  await prisma.inventory.deleteMany({ where: { warehouseId: whId } });
  await prisma.location.deleteMany({ where: { warehouseId: whId } });
}

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();

  // ─── Stable fixtures (upserted) ──────────────────────────────────────
  const wh = await prisma.warehouse.upsert({
    where: { code: WH_CODE },
    update: {},
    create: { code: WH_CODE, name: 'FIFO E2E Warehouse' },
  });
  const cust = await prisma.customer.upsert({
    where: { code: CUST_CODE },
    update: {},
    create: { code: CUST_CODE, name: 'FIFO E2E Customer' },
  });
  const prod = await prisma.product.upsert({
    where: { sku: SKU },
    update: { customerId: cust.id },
    create: { sku: SKU, name: 'FIFO 测试商品', customerId: cust.id },
  });

  await wipeDynamic(prisma, wh.id, cust.id);

  // ─── Fresh EMPTY locations ───────────────────────────────────────────
  const mkLoc = (code: string, zone: string) =>
    prisma.location.create({ data: { code, zone, warehouseId: wh.id, status: 'EMPTY' } });
  const L1 = await mkLoc('FIFO-L1', 'A');
  const L2 = await mkLoc('FIFO-L2', 'A');
  const L3 = await mkLoc('FIFO-L3', 'B');

  // ─── Helpers ─────────────────────────────────────────────────────────
  const mkInv = (locationId: string, batchNo: string, qty: number, inboundDate: Date) =>
    prisma.inventory.create({
      data: {
        warehouseId: wh.id, customerId: cust.id, productId: prod.id, locationId, batchNo,
        availableQty: qty, totalQty: qty, frozenQty: 0,
        inventoryStatus: 'QUALIFIED', inboundDate,
      },
    });
  const reload = (id: string) => prisma.inventory.findUniqueOrThrow({ where: { id } });
  const allocsOf = (orderId: string) =>
    prisma.outboundAllocation.findMany({ where: { outboundItem: { outboundOrderId: orderId } } });
  const invariant = (i: { totalQty: number; availableQty: number; frozenQty: number }) =>
    i.totalQty === i.availableQty + i.frozenQty;

  const svc = new OutboundOrdersService(
    prisma,
    new OperationLogService(prisma),
    new InventoryTransactionService(prisma),
  );
  const invTx = new InventoryTransactionService(prisma);
  const auditSum = async (orderId: string, type: string) => {
    const txs = await invTx.listByRef('OUTBOUND_ORDER', orderId);
    return txs.filter((t) => t.type === type).reduce((s, t) => s + t.qtyChange, 0);
  };

  // Walk ALLOCATED → PACKED so ship() is permitted. These steps are inventory-neutral
  // (only allocate/ship/release touch stock). The pick-scan stage has no endpoint, so we
  // pre-set pickedQty := requiredQty directly, mirroring scripts/e2e-seed-outbound.ts.
  const walkToPacked = async (orderId: string) => {
    const items = await prisma.outboundItem.findMany({
      where: { outboundOrderId: orderId }, include: { product: true },
    });
    for (const it of items) {
      await prisma.outboundItem.update({ where: { id: it.id }, data: { pickedQty: it.requiredQty } });
    }
    await svc.startPicking(orderId);
    await svc.completePicking(orderId);
    await svc.startPacking(orderId);
    for (const it of items) {
      await svc.pack(orderId, { sku: it.product.sku, qty: it.requiredQty });
    }
    await svc.completePacking(orderId);
  };

  const checks: Array<[string, boolean]> = [];

  // ═══ Scenario 1: FIFO ordering + allocate + ship ═════════════════════
  const old = await mkInv(L1.id, 'FIFO-OLD', 6, new Date('2026-01-01T00:00:00Z')); // older
  const fresh = await mkInv(L2.id, 'FIFO-NEW', 10, new Date('2026-02-01T00:00:00Z')); // newer

  const order1: any = await svc.create({
    customerId: cust.id, warehouseId: wh.id, items: [{ productId: prod.id, requiredQty: 8 }],
  } as any);
  await svc.allocate(order1.id);

  let oldR = await reload(old.id);
  let newR = await reload(fresh.id);
  const allocs1 = await allocsOf(order1.id);

  checks.push(['S1 allocate: FIFO drains OLDER batch fully first (avail 0 / frozen 6)',
    oldR.availableQty === 0 && oldR.frozenQty === 6]);
  checks.push(['S1 allocate: NEWER batch used only for remainder (avail 8 / frozen 2)',
    newR.availableQty === 8 && newR.frozenQty === 2]);
  checks.push(['S1 allocate: totalQty unchanged (6 / 10)',
    oldR.totalQty === 6 && newR.totalQty === 10]);
  checks.push(['S1 allocate: invariant total===avail+frozen (both rows)',
    invariant(oldR) && invariant(newR)]);
  checks.push(['S1 allocate: ledger has 2 rows summing 8, older row qty===6',
    allocs1.length === 2 &&
    allocs1.reduce((s, a) => s + a.qty, 0) === 8 &&
    allocs1.find((a) => a.inventoryId === old.id)?.qty === 6]);
  checks.push(['S1 allocate: FREEZE audit Σ qtyChange === -8',
    (await auditSum(order1.id, 'FREEZE')) === -8]);

  await walkToPacked(order1.id);
  await svc.ship(order1.id);
  oldR = await reload(old.id);
  newR = await reload(fresh.id);

  checks.push(['S1 ship: frozen released to 0 (both rows)',
    oldR.frozenQty === 0 && newR.frozenQty === 0]);
  checks.push(['S1 ship: totalQty decremented by shipped qty (0 / 8)',
    oldR.totalQty === 0 && newR.totalQty === 8]);
  checks.push(['S1 ship: availableQty unchanged from allocate (0 / 8)',
    oldR.availableQty === 0 && newR.availableQty === 8]);
  checks.push(['S1 ship: invariant total===avail+frozen (both rows)',
    invariant(oldR) && invariant(newR)]);
  checks.push(['S1 ship: OUTBOUND audit Σ qtyChange === -8',
    (await auditSum(order1.id, 'OUTBOUND')) === -8]);

  // ═══ Scenario 2: allocate → cancel (release restores stock) ══════════
  const rel = await mkInv(L3.id, 'FIFO-REL', 5, new Date('2026-01-15T00:00:00Z'));
  const order2: any = await svc.create({
    customerId: cust.id, warehouseId: wh.id, items: [{ productId: prod.id, requiredQty: 3 }],
  } as any);

  await svc.allocate(order2.id);
  let relR = await reload(rel.id);
  checks.push(['S2 allocate: avail 2 / frozen 3 / total 5',
    relR.availableQty === 2 && relR.frozenQty === 3 && relR.totalQty === 5]);

  await svc.cancel(order2.id);
  relR = await reload(rel.id);
  const allocs2 = await allocsOf(order2.id);
  checks.push(['S2 cancel: stock fully restored (avail 5 / frozen 0 / total 5)',
    relR.availableQty === 5 && relR.frozenQty === 0 && relR.totalQty === 5]);
  checks.push(['S2 cancel: invariant total===avail+frozen', invariant(relR)]);
  checks.push(['S2 cancel: allocation ledger emptied (0 rows)', allocs2.length === 0]);
  checks.push(['S2 cancel: UNFREEZE audit Σ qtyChange === +3',
    (await auditSum(order2.id, 'UNFREEZE')) === 3]);
  checks.push(['S2 cancel: net movement of cancelled order === 0 (FREEZE + UNFREEZE)',
    (await auditSum(order2.id, 'FREEZE')) + (await auditSum(order2.id, 'UNFREEZE')) === 0]);

  // ─── Report ──────────────────────────────────────────────────────────
  console.log('=== sample state ===');
  console.log(JSON.stringify({
    s1_order: order1.orderNo,
    s1_old_after_ship: { avail: oldR.availableQty, frozen: oldR.frozenQty, total: oldR.totalQty },
    s1_new_after_ship: { avail: newR.availableQty, frozen: newR.frozenQty, total: newR.totalQty },
    s2_order: order2.orderNo,
    s2_rel_after_cancel: { avail: relR.availableQty, frozen: relR.frozenQty, total: relR.totalQty },
  }, null, 2));
  console.log('');

  let allOk = true;
  for (const [name, ok] of checks) {
    console.log(`CROSS-CHECK ${name} -> ${ok ? 'PASS' : 'FAIL'}`);
    if (!ok) allOk = false;
  }

  await wipeDynamic(prisma, wh.id, cust.id);
  await prisma.$disconnect();
  console.log(`\n${allOk ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'}`);
  process.exit(allOk ? 0 : 1);
}

main().catch(async (e) => {
  console.error('VERIFY ERROR:', e?.message ?? e);
  process.exit(1);
});
