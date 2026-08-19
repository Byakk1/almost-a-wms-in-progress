import 'reflect-metadata';
import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { BoxesService } from '../src/boxes/boxes.service';
import { OperationLogService } from '../src/common/operation-log.service';

// E2E verification of the Box (carton) module — report v4.22.
// Drives the REAL BoxesService against the live DB on an ISOLATED fixture
// (own warehouse WH-BOX-E2E / customer CUST-BOX-E2E), so nothing here can
// touch the 100+ real fulfillment orders in the shared database.
//
//   · create(3)   → PENDING, boxNo BOX-YYMMDD-NNNN, sequential
//   · measure b1  → 30×20×10 / 2.5kg  → vol 1.2, charge 2.5  (actual-weight branch)
//   · measure b2  → 100×50×40 / 5kg   → vol 40,  charge 40   (volumetric branch)
//   · list        → status filter + orderNo/customerName flattening
//   · atomicity   → sign-out [MEASURED, PENDING] rejected AND the good box untouched
//   · sign out    → both MEASURED → SIGNED_OUT, trackingNo persisted
//   · guards      → measure unknown (404), measure SIGNED_OUT (400),
//                   re-sign-out (400), sign-out unknown boxNo (400)
//   · audit       → an OperationLog row per CREATE / MEASURE / SIGN_OUT
//
// Re-runnable: warehouse/customer upserted; all dynamic rows wiped before + after.

const WH_CODE = 'WH-BOX-E2E';
const CUST_CODE = 'CUST-BOX-E2E';

async function wipeDynamic(prisma: PrismaService, custId: string) {
  // Box has onDelete: Cascade from TransitOrder, but delete explicitly so the
  // audit rows can be matched by id first.
  const boxes = await prisma.box.findMany({
    where: { transitOrder: { customerId: custId } },
    select: { id: true },
  });
  if (boxes.length) {
    await prisma.operationLog.deleteMany({
      where: { entityType: 'BOX', entityId: { in: boxes.map((b) => b.id) } },
    });
  }
  await prisma.box.deleteMany({ where: { transitOrder: { customerId: custId } } });
  await prisma.transitOrder.deleteMany({ where: { customerId: custId } });
}

/** Run fn expecting a throw; returns the message, or null if it wrongly succeeded. */
async function expectErr(fn: () => Promise<any>): Promise<string | null> {
  try {
    await fn();
    return null;
  } catch (e: any) {
    return e?.message ?? 'error';
  }
}

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();

  const wh = await prisma.warehouse.upsert({
    where: { code: WH_CODE }, update: {},
    create: { code: WH_CODE, name: 'Box E2E Warehouse' },
  });
  const cust = await prisma.customer.upsert({
    where: { code: CUST_CODE }, update: {},
    create: { code: CUST_CODE, name: 'Box E2E Customer' },
  });

  await wipeDynamic(prisma, cust.id);

  const order = await prisma.transitOrder.create({
    data: {
      orderNo: `TR-BOX-E2E-${Date.now()}`,
      customerId: cust.id,
      warehouseId: wh.id,
      status: 'PENDING',
    },
  });

  const svc = new BoxesService(prisma, new OperationLogService(prisma));
  const checks: Array<[string, boolean]> = [];

  // ─── Create ──────────────────────────────────────────────────────────
  const created: any[] = await svc.create({
    transitOrderId: order.id, count: 3, pieces: 4, destination: 'US', courier: 'FedEx',
  });
  const [b1, b2, b3] = created;

  checks.push(['create: 3 boxes returned', created.length === 3]);
  checks.push(['create: all PENDING', created.every((b) => b.status === 'PENDING')]);
  checks.push(['create: boxNo format BOX-YYMMDD-NNNN', created.every((b) => /^BOX-\d{6}-\d{4}$/.test(b.boxNo))]);
  checks.push([
    'create: boxNo sequential',
    Number(b2.boxNo.slice(-4)) === Number(b1.boxNo.slice(-4)) + 1 &&
      Number(b3.boxNo.slice(-4)) === Number(b2.boxNo.slice(-4)) + 1,
  ]);
  checks.push(['create: orderNo flattened onto view', b1.orderNo === order.orderNo]);
  checks.push(['create: customerName flattened onto view', b1.customerName === cust.name]);

  // ─── Measure: actual-weight branch (2.5kg beats 1.2kg volumetric) ────
  const m1: any = await svc.measure(b1.boxNo, { length: 30, width: 20, height: 10, actualWeight: 2.5 });
  checks.push(['measure b1: status MEASURED', m1.status === 'MEASURED']);
  checks.push(['measure b1: volWeight 30*20*10/5000 = 1.2', m1.volWeight === 1.2]);
  checks.push(['measure b1: chargeWeight = max(1.2, 2.5) = 2.5', m1.chargeWeight === 2.5]);
  checks.push(['measure b1: measuredAt stamped', !!m1.measuredAt]);

  // ─── Measure: volumetric branch (40kg beats 5kg actual) ──────────────
  const m2: any = await svc.measure(b2.boxNo, { length: 100, width: 50, height: 40, actualWeight: 5 });
  checks.push(['measure b2: volWeight 100*50*40/5000 = 40', m2.volWeight === 40]);
  checks.push(['measure b2: chargeWeight = max(40, 5) = 40', m2.chargeWeight === 40]);

  // ─── List ────────────────────────────────────────────────────────────
  const measuredList = await svc.list({ status: 'MEASURED', transitOrderId: order.id });
  checks.push(['list: status=MEASURED returns 2', measuredList.pagination.total === 2]);
  const pendingList = await svc.list({ status: 'PENDING', transitOrderId: order.id });
  checks.push(['list: status=PENDING returns 1 (b3)', pendingList.pagination.total === 1]);
  const byNo = await svc.list({ boxNo: b1.boxNo });
  checks.push(['list: boxNo filter returns exactly 1', byNo.pagination.total === 1 && byNo.data[0].boxNo === b1.boxNo]);

  // ─── Atomicity: a bad box in the batch must roll the whole thing back ─
  const partialErr = await expectErr(() =>
    svc.signOut({ boxNos: [b1.boxNo, b3.boxNo], trackingNo: 'SF-ROLLBACK-TEST' }),
  );
  checks.push(['guard: sign-out with a PENDING box rejected', partialErr !== null]);
  const b1AfterRollback = await prisma.box.findUnique({ where: { boxNo: b1.boxNo } });
  checks.push([
    'atomicity: b1 still MEASURED, no trackingNo written',
    b1AfterRollback?.status === 'MEASURED' && b1AfterRollback?.trackingNo === null,
  ]);

  // ─── Sign out ────────────────────────────────────────────────────────
  const signed: any = await svc.signOut({
    boxNos: [b1.boxNo, b2.boxNo], trackingNo: 'SF1234567890', courier: 'SF Express',
  });
  checks.push(['signOut: count 2', signed.count === 2]);
  checks.push(['signOut: both SIGNED_OUT', signed.boxes.every((b: any) => b.status === 'SIGNED_OUT')]);
  checks.push(['signOut: trackingNo persisted', signed.boxes.every((b: any) => b.trackingNo === 'SF1234567890')]);
  checks.push(['signOut: courier overridden to SF Express', signed.boxes.every((b: any) => b.courier === 'SF Express')]);
  checks.push(['signOut: signedOutAt stamped', signed.boxes.every((b: any) => !!b.signedOutAt)]);

  // ─── Guards ──────────────────────────────────────────────────────────
  const unknownMeasure = await expectErr(() =>
    svc.measure('BOX-NOPE-9999', { length: 1, width: 1, height: 1, actualWeight: 1 }),
  );
  checks.push(['guard: measure unknown boxNo → error', unknownMeasure !== null]);

  const measureSignedOut = await expectErr(() =>
    svc.measure(b1.boxNo, { length: 10, width: 10, height: 10, actualWeight: 1 }),
  );
  checks.push([
    'guard: measure a SIGNED_OUT box → state-machine error',
    measureSignedOut !== null && measureSignedOut.includes('SIGNED_OUT'),
  ]);

  const reSignOut = await expectErr(() => svc.signOut({ boxNos: [b1.boxNo], trackingNo: 'SF-AGAIN' }));
  checks.push(['guard: re-sign-out → state-machine error', reSignOut !== null]);

  const unknownSignOut = await expectErr(() =>
    svc.signOut({ boxNos: [b3.boxNo, 'BOX-NOPE-0001'], trackingNo: 'SF-X' }),
  );
  checks.push(['guard: sign-out unknown boxNo → error', unknownSignOut !== null]);

  // ─── Audit trail ─────────────────────────────────────────────────────
  const logs = await prisma.operationLog.findMany({
    where: { entityType: 'BOX', entityId: { in: [b1.id, b2.id, b3.id] } },
    select: { action: true },
  });
  const actions = logs.map((l) => l.action);
  checks.push(['audit: 3 CREATE rows', actions.filter((a) => a === 'CREATE').length === 3]);
  checks.push(['audit: 2 MEASURE rows', actions.filter((a) => a === 'MEASURE').length === 2]);
  checks.push(['audit: 2 SIGN_OUT rows', actions.filter((a) => a === 'SIGN_OUT').length === 2]);

  // ─── Report ──────────────────────────────────────────────────────────
  console.log('=== sample ===');
  console.log(JSON.stringify({
    transitOrder: order.orderNo,
    b1: { boxNo: m1.boxNo, size: '30x20x10', actual: 2.5, vol: m1.volWeight, charge: m1.chargeWeight },
    b2: { boxNo: m2.boxNo, size: '100x50x40', actual: 5, vol: m2.volWeight, charge: m2.chargeWeight },
    signOut: { count: signed.count, trackingNo: 'SF1234567890' },
    rejections: { partialBatch: partialErr, measureSignedOut, reSignOut, unknownSignOut },
  }, null, 2));
  console.log('');

  let allOk = true;
  for (const [name, okFlag] of checks) {
    console.log(`CROSS-CHECK ${name} -> ${okFlag ? 'PASS' : 'FAIL'}`);
    if (!okFlag) allOk = false;
  }

  await wipeDynamic(prisma, cust.id);
  await prisma.$disconnect();
  console.log(`\n${allOk ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'} (${checks.length} checks)`);
  process.exit(allOk ? 0 : 1);
}

main().catch(async (e) => {
  console.error('VERIFY ERROR:', e?.message ?? e);
  process.exit(1);
});
