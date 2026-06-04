import 'reflect-metadata';
import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { OutboundOrdersService } from '../src/outbound-orders/outbound-orders.service';
import { WavesService } from '../src/waves/waves.service';
import { OperationLogService } from '../src/common/operation-log.service';
import { InventoryTransactionService } from '../src/common/inventory-transaction.service';

// E2E verification of Wave management (Sprint 5 item 3, report v4.11).
// Drives the REAL WavesService + OutboundOrdersService against the live DB on an
// ISOLATED fixture (own warehouse WH-WAVE-E2E). Orders are first ALLOCATED via the
// real allocate() (FIFO), so the pick list can be derived from the allocation ledger.
//
//   · create(摘果) → member order ALLOCATED→WAVE_ASSIGNED, wave PENDING, waveNo WV-YYMMDD-NNNN
//   · create(播种, 2 orders) → both WAVE_ASSIGNED
//   · pickList 摘果 → grouped per order; sku/location/qty match the allocation
//   · pickList 播种 → aggregated by (sku,location), totalQty = Σ orders, sow[] sums back
//   · release → members WAVE_ASSIGNED→PICKING, wave RELEASED
//   · cancel  → members WAVE_ASSIGNED→ALLOCATED (un-assign), wave CANCELLED
//   · guard   → wave from a non-ALLOCATED order rejected, no orphan wave row
//
// Re-runnable: warehouse/customer/product upserted; all dynamic rows wiped before+after.

const WH_CODE = 'WH-WAVE-E2E';
const CUST_CODE = 'CUST-WAVE-E2E';
const SKU = 'SKU-WAVE';

async function wipeDynamic(prisma: PrismaService, whId: string, custId: string) {
  // Order matters (FK): waves cascade waveOrders (which RESTRICT-ref orders); then orders
  // cascade items→allocations; then txns; then inventory; then locations.
  await prisma.wave.deleteMany({ where: { warehouseId: whId } });
  await prisma.outboundOrder.deleteMany({ where: { customerId: custId } });
  await prisma.inventoryTransaction.deleteMany({ where: { warehouseId: whId } });
  await prisma.inventory.deleteMany({ where: { warehouseId: whId } });
  await prisma.location.deleteMany({ where: { warehouseId: whId } });
}

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();

  const wh = await prisma.warehouse.upsert({
    where: { code: WH_CODE }, update: {},
    create: { code: WH_CODE, name: 'Wave E2E Warehouse' },
  });
  const cust = await prisma.customer.upsert({
    where: { code: CUST_CODE }, update: {},
    create: { code: CUST_CODE, name: 'Wave E2E Customer' },
  });
  const prod = await prisma.product.upsert({
    where: { sku: SKU }, update: { customerId: cust.id },
    create: { sku: SKU, name: '波次测试商品', customerId: cust.id },
  });

  await wipeDynamic(prisma, wh.id, cust.id);

  // One EMPTY location with ample stock so every order pulls from the SAME (sku,location)
  // — which makes the 播种 aggregation meaningful.
  const loc = await prisma.location.create({ data: { code: 'WAVE-L1', zone: 'A', warehouseId: wh.id, status: 'EMPTY' } });
  await prisma.inventory.create({
    data: {
      warehouseId: wh.id, customerId: cust.id, productId: prod.id, locationId: loc.id,
      batchNo: 'WAVE-B1', availableQty: 100, totalQty: 100, frozenQty: 0,
      inventoryStatus: 'QUALIFIED', inboundDate: new Date('2026-01-01T00:00:00Z'),
    },
  });

  const outboundSvc = new OutboundOrdersService(
    prisma, new OperationLogService(prisma), new InventoryTransactionService(prisma),
  );
  const waveSvc = new WavesService(prisma, new OperationLogService(prisma));

  const mkOrder = (qty: number) =>
    outboundSvc.create({ customerId: cust.id, warehouseId: wh.id, items: [{ productId: prod.id, requiredQty: qty }] } as any);
  const statusOf = async (id: string) => (await prisma.outboundOrder.findUniqueOrThrow({ where: { id } })).status;

  // O1=5, O2=3, O3=4 allocated; O4=2 left PENDING (for the guard test).
  const o1: any = await mkOrder(5);
  const o2: any = await mkOrder(3);
  const o3: any = await mkOrder(4);
  const o4: any = await mkOrder(2);
  await outboundSvc.allocate(o1.id);
  await outboundSvc.allocate(o2.id);
  await outboundSvc.allocate(o3.id);

  const checks: Array<[string, boolean]> = [];

  // ─── Guard: wave from a non-ALLOCATED (PENDING) order is rejected ────
  const wavesBefore = await prisma.wave.count({ where: { warehouseId: wh.id } });
  let guardRejected = false;
  try {
    await waveSvc.create({ warehouseId: wh.id, strategy: 'PICK_AND_PASS', orderIds: [o4.id] });
  } catch (e: any) {
    guardRejected = /ALLOCATED/.test(e?.message ?? '');
  }
  const wavesAfter = await prisma.wave.count({ where: { warehouseId: wh.id } });
  checks.push(['guard: non-ALLOCATED order rejected', guardRejected]);
  checks.push(['guard: rejected create left no orphan wave', wavesAfter === wavesBefore]);

  // ─── Create wave1 (摘果, O1) ─────────────────────────────────────────
  const w1: any = await waveSvc.create({ warehouseId: wh.id, strategy: 'PICK_AND_PASS', orderIds: [o1.id] });
  checks.push(['create摘果: waveNo matches WV-YYMMDD-NNNN', /^WV-\d{6}-\d{4}$/.test(w1.waveNo)]);
  checks.push(['create摘果: wave PENDING, orderCount 1', w1.status === 'PENDING' && w1.orderCount === 1]);
  checks.push(['create摘果: O1 → WAVE_ASSIGNED', (await statusOf(o1.id)) === 'WAVE_ASSIGNED']);

  // ─── Create wave2 (播种, O2+O3) ──────────────────────────────────────
  const w2: any = await waveSvc.create({ warehouseId: wh.id, strategy: 'BATCH_SOW', orderIds: [o2.id, o3.id] });
  checks.push(['create播种: wave PENDING, orderCount 2', w2.status === 'PENDING' && w2.orderCount === 2]);
  checks.push(['create播种: O2 & O3 → WAVE_ASSIGNED',
    (await statusOf(o2.id)) === 'WAVE_ASSIGNED' && (await statusOf(o3.id)) === 'WAVE_ASSIGNED']);

  // ─── Pick list: 摘果 grouped per order ───────────────────────────────
  const pl1: any = await waveSvc.pickList(w1.id);
  const o1Group = pl1.orders?.find((g: any) => g.orderNo === o1.orderNo);
  checks.push(['pickList摘果: shape has orders[], grouped by order', Array.isArray(pl1.orders) && !!o1Group]);
  checks.push(['pickList摘果: O1 line = SKU-WAVE @ WAVE-L1 qty 5',
    o1Group?.lines?.length === 1 &&
    o1Group.lines[0].sku === SKU && o1Group.lines[0].locationCode === 'WAVE-L1' && o1Group.lines[0].qty === 5]);

  // ─── Pick list: 播种 aggregated by (sku,location) + sow breakdown ────
  const pl2: any = await waveSvc.pickList(w2.id);
  const agg = pl2.lines?.find((l: any) => l.sku === SKU && l.locationCode === 'WAVE-L1');
  const sowSum = agg?.sow?.reduce((s: number, x: any) => s + x.qty, 0);
  checks.push(['pickList播种: shape has lines[], aggregated by sku+location', Array.isArray(pl2.lines) && !!agg]);
  checks.push(['pickList播种: totalQty 7 = O2(3)+O3(4)', agg?.totalQty === 7]);
  checks.push(['pickList播种: sow[] has 2 orders summing 7', agg?.sow?.length === 2 && sowSum === 7]);

  // ─── Release wave2 → members PICKING ─────────────────────────────────
  const w2r: any = await waveSvc.release(w2.id);
  checks.push(['release: wave2 RELEASED', w2r.status === 'RELEASED']);
  checks.push(['release: O2 & O3 → PICKING',
    (await statusOf(o2.id)) === 'PICKING' && (await statusOf(o3.id)) === 'PICKING']);

  // ─── Cancel wave1 → member un-assigned back to ALLOCATED ─────────────
  const w1c: any = await waveSvc.cancel(w1.id);
  checks.push(['cancel: wave1 CANCELLED', w1c.status === 'CANCELLED']);
  checks.push(['cancel: O1 → ALLOCATED (un-assign, inventory-neutral)', (await statusOf(o1.id)) === 'ALLOCATED']);

  // ─── Report ──────────────────────────────────────────────────────────
  console.log('=== sample ===');
  console.log(JSON.stringify({
    wave1: { waveNo: w1.waveNo, strategy: w1.strategy, finalStatus: w1c.status },
    wave2: { waveNo: w2.waveNo, strategy: w2.strategy, finalStatus: w2r.status },
    pickList摘果_O1: o1Group,
    pickList播种_agg: agg,
  }, null, 2));
  console.log('');

  let allOk = true;
  for (const [name, okFlag] of checks) {
    console.log(`CROSS-CHECK ${name} -> ${okFlag ? 'PASS' : 'FAIL'}`);
    if (!okFlag) allOk = false;
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
