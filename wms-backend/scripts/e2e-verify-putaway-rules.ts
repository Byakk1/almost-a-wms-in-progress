import 'reflect-metadata';
import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { PutawayRulesService } from '../src/putaway-rules/putaway-rules.service';
import { PutawayTasksService } from '../src/putaway-tasks/putaway-tasks.service';

// E2E verification of the Putaway Strategy Engine (PutawayRule).
// Seeds an ISOLATED, idempotent fixture (own warehouse WH-PUTRULE-E2E), then drives the
// REAL PutawayTasksService.list() against the live DB and asserts the recommendation engine:
//   - electronics tasks (itemType '电子产品') route to zone A (exact rule, priority 100)
//   - general task (catch-all '*') routes to zone B (priority 0)
//   - two tasks never share one single-occupancy location (response-scoped dedup)
//   - every recommended location is EMPTY and in the same warehouse
// Re-runnable: all writes are upserts; rules are reset; tasks reset to PENDING.

const WH_CODE = 'WH-PUTRULE-E2E';

async function seedFixture(prisma: PrismaService) {
  const wh = await prisma.warehouse.upsert({
    where: { code: WH_CODE },
    update: {},
    create: { code: WH_CODE, name: 'Putaway-Rule E2E Warehouse' },
  });
  const cust = await prisma.customer.upsert({
    where: { code: 'CUST-PUTRULE-E2E' },
    update: {},
    create: { code: 'CUST-PUTRULE-E2E', name: 'Putaway-Rule E2E Customer' },
  });

  // EMPTY locations: zone A x2 (for the 2 electronics tasks -> tests dedup), zone B x2.
  for (const l of [
    { code: 'PR-A-01', zone: 'A' },
    { code: 'PR-A-02', zone: 'A' },
    { code: 'PR-B-01', zone: 'B' },
    { code: 'PR-B-02', zone: 'B' },
  ]) {
    await prisma.location.upsert({
      where: { code: l.code },
      update: { status: 'EMPTY', zone: l.zone, warehouseId: wh.id },
      create: { code: l.code, zone: l.zone, warehouseId: wh.id, status: 'EMPTY' },
    });
  }

  const elec = await prisma.product.upsert({
    where: { sku: 'SKU-PR-ELEC' },
    update: { itemType: '电子产品', customerId: cust.id },
    create: { sku: 'SKU-PR-ELEC', name: '电子产品样品', itemType: '电子产品', customerId: cust.id },
  });
  const gen = await prisma.product.upsert({
    where: { sku: 'SKU-PR-GEN' },
    update: { itemType: null, customerId: cust.id },
    create: { sku: 'SKU-PR-GEN', name: '普通货物样品', itemType: null, customerId: cust.id },
  });

  // PutawayTask.receivingOrderId is required -> provide a fixture receiving order.
  const ro = await prisma.receivingOrder.upsert({
    where: { receivingNo: 'RO-PR-E2E-001' },
    update: {},
    create: { receivingNo: 'RO-PR-E2E-001', customerId: cust.id, warehouseId: wh.id, status: 'PUTAWAY_PENDING' },
  });

  const taskDefs = [
    { taskNo: 'PT-PR-ELEC-1', productId: elec.id, qty: 5 },
    { taskNo: 'PT-PR-ELEC-2', productId: elec.id, qty: 7 },
    { taskNo: 'PT-PR-GEN-1', productId: gen.id, qty: 3 },
  ];
  for (const t of taskDefs) {
    await prisma.putawayTask.upsert({
      where: { taskNo: t.taskNo },
      update: { status: 'PENDING', locationId: null, productId: t.productId, qty: t.qty, warehouseId: wh.id, receivingOrderId: ro.id },
      create: { taskNo: t.taskNo, productId: t.productId, qty: t.qty, warehouseId: wh.id, receivingOrderId: ro.id, status: 'PENDING' },
    });
  }

  // Rules for THIS warehouse only (reset for idempotency): 电子产品 -> A (100), catch-all -> B (0).
  await prisma.putawayRule.deleteMany({ where: { warehouseId: wh.id } });
  await prisma.putawayRule.createMany({
    data: [
      { warehouseId: wh.id, zone: 'A', productCategory: '电子产品', priority: 100 },
      { warehouseId: wh.id, zone: 'B', productCategory: '*', priority: 0 },
    ],
  });

  return { whId: wh.id, taskNos: taskDefs.map((t) => t.taskNo) };
}

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();

  const { whId, taskNos } = await seedFixture(prisma);

  // Drive the real service exactly as the controller does.
  const putawayRules = new PutawayRulesService(prisma);
  const putawayTasks = new PutawayTasksService(prisma, putawayRules);
  const res = await putawayTasks.list({ status: 'PENDING', pageSize: 100 });
  const rows = res.data.filter((r: any) => taskNos.includes(r.taskNo));
  const byTask: Record<string, any> = {};
  rows.forEach((r: any) => (byTask[r.taskNo] = r));

  console.log('=== fixture recommendations ===');
  rows.forEach((r: any) => console.log(`  ${r.taskNo}  sku=${r.sku}  ->  ${r.recommendedLocationCode ?? '(none)'}`));
  console.log('');

  const checks: Array<[string, boolean]> = [];

  // 1. shape (additive fields present on every fixture row)
  checks.push([
    `shape: ${rows.length}/${taskNos.length} fixture rows carry recommendedLocation* keys`,
    rows.length === taskNos.length &&
      rows.every((r: any) => 'recommendedLocationId' in r && 'recommendedLocationCode' in r),
  ]);

  // 2. routing: electronics -> zone A
  checks.push([
    `routing: electronics tasks -> zone A (PR-A-01/PR-A-02)`,
    ['PT-PR-ELEC-1', 'PT-PR-ELEC-2'].every((tn) =>
      ['PR-A-01', 'PR-A-02'].includes(byTask[tn]?.recommendedLocationCode)),
  ]);

  // 3. routing: general -> zone B (catch-all)
  checks.push([
    `routing: general task -> zone B catch-all (PR-B-01/PR-B-02)`,
    ['PR-B-01', 'PR-B-02'].includes(byTask['PT-PR-GEN-1']?.recommendedLocationCode),
  ]);

  // 4. dedup: distinct locations, one per task
  const ids = rows.map((r: any) => r.recommendedLocationId).filter(Boolean);
  checks.push([
    `dedup: ${ids.length} distinct recommended locations for ${taskNos.length} tasks`,
    new Set(ids).size === ids.length && ids.length === taskNos.length,
  ]);

  // 5. integrity: every recommended location is EMPTY + same warehouse
  let integrityOk = ids.length > 0;
  for (const id of ids) {
    const loc = await prisma.location.findUnique({ where: { id } });
    if (!loc || loc.status !== 'EMPTY' || loc.warehouseId !== whId) integrityOk = false;
  }
  checks.push([`integrity: every recommended location is EMPTY + same warehouse`, integrityOk]);

  let allOk = true;
  for (const [name, ok] of checks) {
    console.log(`CROSS-CHECK ${name} -> ${ok ? 'PASS' : 'FAIL'}`);
    if (!ok) allOk = false;
  }

  await prisma.$disconnect();
  console.log(`\n${allOk ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'}`);
  process.exit(allOk ? 0 : 1);
}

main().catch(async (e) => {
  console.error('VERIFY ERROR:', e?.message ?? e);
  process.exit(1);
});
