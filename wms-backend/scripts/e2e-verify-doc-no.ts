import 'reflect-metadata';
import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { ReceivingOrdersService } from '../src/receiving-orders/receiving-orders.service';
import { OperationLogService } from '../src/common/operation-log.service';
import { dailyPrefix, nextDocNo, isUniqueViolation } from '../src/common/doc-no';

// Verifies dated document-number generation (report v4.30).
//
// The bug being locked out: `count() + 1` reuses a number as soon as ANY row is
// deleted. Deleting a MIDDLE row is the killer — count drops by one, so the next
// insert regenerates a number that still exists and trips the unique constraint.
// `max + 1` is immune. This drove receivingNo, exceptionNo and putaway taskNo;
// only orderNo had been fixed (v4.13).
//
// Isolated fixture (WH-DOCNO-E2E / CUST-DOCNO-E2E); all dynamic rows wiped
// before and after, so the real receiving orders are never touched.

const WH_CODE = 'WH-DOCNO-E2E';
const CUST_CODE = 'CUST-DOCNO-E2E';

async function wipe(prisma: PrismaService, custId: string) {
  const orders = await prisma.receivingOrder.findMany({
    where: { customerId: custId },
    select: { id: true },
  });
  const ids = orders.map((o) => o.id);
  if (ids.length) {
    await prisma.putawayTask.deleteMany({ where: { receivingOrderId: { in: ids } } });
    await prisma.operationLog.deleteMany({
      where: { entityType: 'RECEIVING_ORDER', entityId: { in: ids } },
    });
  }
  await prisma.receivingOrder.deleteMany({ where: { customerId: custId } });
}

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();

  const checks: Array<[string, boolean]> = [];
  const push = (name: string, ok: boolean) => checks.push([name, ok]);

  // ─── Pure helper semantics ───────────────────────────────────────────
  const p = dailyPrefix('IN');
  push('dailyPrefix shape IN-YYMMDD-', /^IN-\d{6}-$/.test(p));
  push('nextDocNo(null) → 0001', nextDocNo(p, null) === `${p}0001`);
  push('nextDocNo advances', nextDocNo(p, `${p}0003`) === `${p}0004`);
  push('nextDocNo respects width 3', nextDocNo('PT-260820-', 'PT-260820-007', 3) === 'PT-260820-008');
  push('nextDocNo rolls past 9', nextDocNo('PT-260820-', 'PT-260820-009', 3) === 'PT-260820-010');

  let threw = false;
  try { nextDocNo(p, `${p}abcd`); } catch { threw = true; }
  push('nextDocNo throws on unparseable seq', threw);

  push('isUniqueViolation detects P2002', isUniqueViolation({ code: 'P2002' }) && !isUniqueViolation(new Error('x')));

  // ─── Fixture ─────────────────────────────────────────────────────────
  const wh = await prisma.warehouse.upsert({
    where: { code: WH_CODE }, update: {},
    create: { code: WH_CODE, name: 'DocNo E2E Warehouse' },
  });
  const cust = await prisma.customer.upsert({
    where: { code: CUST_CODE }, update: {},
    create: { code: CUST_CODE, name: 'DocNo E2E Customer' },
  });
  const product = await prisma.product.findFirst({ select: { id: true } });
  if (!product) throw new Error('no product available for fixture');

  await wipe(prisma, cust.id);

  const svc = new ReceivingOrdersService(prisma, new OperationLogService(prisma));
  const mk = () =>
    svc.create({
      customerId: cust.id,
      warehouseId: wh.id,
      expectedQuantity: 1,
      items: [{ productId: product.id, expectedQty: 1 }],
    });

  // ─── receivingNo: the delete-a-middle-row scenario ───────────────────
  const a: any = await mk();
  const b: any = await mk();
  const c: any = await mk();
  const seqOf = (no: string) => Number(no.slice(dailyPrefix('IN').length));

  push('receivingNo sequential', seqOf(b.receivingNo) === seqOf(a.receivingNo) + 1 && seqOf(c.receivingNo) === seqOf(b.receivingNo) + 1);

  // Delete the MIDDLE row — this is what used to poison the next insert.
  await prisma.receivingItem.deleteMany({ where: { receivingOrderId: b.id } });
  await prisma.receivingOrder.delete({ where: { id: b.id } });

  let collided = false;
  let d: any = null;
  try { d = await mk(); } catch (e) { collided = isUniqueViolation(e); }

  push('receivingNo: create after middle delete does NOT collide', !collided && !!d);
  push('receivingNo: new number is max+1, not a reused one',
    !!d && seqOf(d.receivingNo) === seqOf(c.receivingNo) + 1);
  push('receivingNo: no duplicate exists',
    !!d && (await prisma.receivingOrder.count({ where: { receivingNo: d.receivingNo } })) === 1);

  // ─── taskNo: same scenario, generated inside complete()'s transaction ─
  const ptPrefix = dailyPrefix('PT');
  const ptSeq = (no: string) => Number(no.slice(ptPrefix.length));

  const complete = async (orderId: string) => {
    await svc.startChecking(orderId);
    await svc.receive(orderId, { sku: (await prisma.product.findUnique({ where: { id: product.id }, select: { sku: true } }))!.sku, qty: 1 });
    return svc.complete(orderId) as any;
  };

  const r1 = await complete(a.id);
  const t1 = r1.createdPutawayTasks[0];
  const r2 = await complete(c.id);
  const t2 = r2.createdPutawayTasks[0];

  push('taskNo sequential across orders', ptSeq(t2.taskNo) === ptSeq(t1.taskNo) + 1);

  // Delete the earlier task, then generate another — old code would reuse t2's number.
  await prisma.putawayTask.delete({ where: { id: t1.id } });

  let taskCollided = false;
  let t3: any = null;
  try {
    const r3 = await complete(d.id);
    t3 = r3.createdPutawayTasks[0];
  } catch (e) {
    taskCollided = isUniqueViolation(e);
  }

  push('taskNo: create after delete does NOT collide', !taskCollided && !!t3);
  push('taskNo: new number is max+1', !!t3 && ptSeq(t3.taskNo) === ptSeq(t2.taskNo) + 1);

  // ─── Report ──────────────────────────────────────────────────────────
  console.log('=== sample ===');
  console.log(JSON.stringify({
    receiving: { a: a.receivingNo, b_deleted: b.receivingNo, c: c.receivingNo, d_after_delete: d?.receivingNo },
    putaway: { t1_deleted: t1.taskNo, t2: t2.taskNo, t3_after_delete: t3?.taskNo },
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
