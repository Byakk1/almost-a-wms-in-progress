import 'reflect-metadata';
import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { OutboundOrdersService } from '../src/outbound-orders/outbound-orders.service';
import { OperationLogService } from '../src/common/operation-log.service';
import { InventoryTransactionService } from '../src/common/inventory-transaction.service';

// E2E verification of the pick-registration endpoint and outbound exception closing
// (report v4.31).
//
// WHAT THIS EXISTS TO PROVE
// Until now the outbound lifecycle was BROKEN at PICKING -> PICKED: completePicking
// requires every item to satisfy pickedQty >= requiredQty, but nothing in the codebase
// ever wrote pickedQty. It was read in three places and written in none. Every E2E that
// "passed" the full lifecycle did so by writing pickedQty straight into the database
// (see the comment on scripts/e2e-seed-outbound.ts line 2). In real operation no order
// could ever reach PACKED, SHIPPED or SIGNED.
//
// So the headline assertion here is: the ENTIRE lifecycle PENDING -> SIGNED runs through
// service calls with ZERO direct writes to pickedQty. If someone reintroduces the gap,
// this file fails.
//
// Also covers OutboundException.status, which was write-once ('OPEN' at creation, with
// no code path able to change it).
//
// Isolated fixture (WH-PICK-E2E / CUST-PICK-E2E / SKU-PICK-A); all dynamic rows wiped
// before and after, so real orders and stock are never touched.

const WH_CODE = 'WH-PICK-E2E';
const CUST_CODE = 'CUST-PICK-E2E';
const SKU = 'SKU-PICK-A';

async function wipeDynamic(prisma: PrismaService, whId: string, custId: string) {
  const orders = await prisma.outboundOrder.findMany({
    where: { customerId: custId }, select: { id: true },
  });
  const ids = orders.map((o) => o.id);
  if (ids.length) {
    await prisma.operationLog.deleteMany({
      where: { entityType: 'OUTBOUND_ORDER', entityId: { in: ids } },
    });
    const exs = await prisma.outboundException.findMany({
      where: { outboundOrderId: { in: ids } }, select: { id: true },
    });
    if (exs.length) {
      await prisma.operationLog.deleteMany({
        where: { entityType: 'OUTBOUND_EXCEPTION', entityId: { in: exs.map((e) => e.id) } },
      });
    }
  }
  await prisma.outboundOrder.deleteMany({ where: { customerId: custId } });
  await prisma.inventoryTransaction.deleteMany({ where: { warehouseId: whId } });
  await prisma.inventory.deleteMany({ where: { warehouseId: whId } });
  await prisma.location.deleteMany({ where: { warehouseId: whId } });
}

/** Run fn expecting a throw; returns the message, or null if it wrongly succeeded. */
async function expectErr(fn: () => Promise<any>): Promise<string | null> {
  try { await fn(); return null; } catch (e: any) { return e?.message ?? 'error'; }
}

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();

  const wh = await prisma.warehouse.upsert({
    where: { code: WH_CODE }, update: {},
    create: { code: WH_CODE, name: 'Pick E2E Warehouse' },
  });
  const cust = await prisma.customer.upsert({
    where: { code: CUST_CODE }, update: {},
    create: { code: CUST_CODE, name: 'Pick E2E Customer' },
  });
  const prod = await prisma.product.upsert({
    where: { sku: SKU }, update: { customerId: cust.id },
    create: { sku: SKU, name: '拣货测试商品', customerId: cust.id },
  });

  await wipeDynamic(prisma, wh.id, cust.id);

  const loc = await prisma.location.create({
    data: { code: 'PICK-L1', zone: 'A', warehouseId: wh.id, status: 'EMPTY' },
  });
  await prisma.inventory.create({
    data: {
      warehouseId: wh.id, customerId: cust.id, productId: prod.id, locationId: loc.id,
      batchNo: 'PICK-B1', availableQty: 10, totalQty: 10, frozenQty: 0,
      inventoryStatus: 'QUALIFIED', inboundDate: new Date(),
    },
  });

  const svc = new OutboundOrdersService(
    prisma,
    new OperationLogService(prisma),
    new InventoryTransactionService(prisma),
  );

  const checks: Array<[string, boolean]> = [];
  const push = (n: string, ok: boolean) => checks.push([n, ok]);

  const mkOrder = () =>
    svc.create({
      customerId: cust.id, warehouseId: wh.id,
      items: [{ productId: prod.id, requiredQty: 3 }],
    } as any);

  // ─── Lifecycle, entirely through service calls ───────────────────────
  const order: any = await mkOrder();
  await svc.allocate(order.id);

  // Picking before the order is in PICKING must be refused.
  const tooEarly = await expectErr(() => svc.pick(order.id, { sku: SKU, qty: 1 }));
  push('guard: pick before start-picking rejected', tooEarly !== null && tooEarly.includes('ALLOCATED'));

  await svc.startPicking(order.id);

  const unknownSku = await expectErr(() => svc.pick(order.id, { sku: 'NOPE-SKU', qty: 1 }));
  push('guard: pick unknown SKU rejected', unknownSku !== null);

  const p1: any = await svc.pick(order.id, { sku: SKU, qty: 2 });
  push('pick: pickedQty accumulates to 2', p1.pickedQty === 2);
  push('pick: allPicked false while short', p1.allPicked === false);

  // completePicking must still refuse while an item is short — this is the invariant
  // that used to be satisfied only by writing the database directly.
  const stillShort = await expectErr(() => svc.completePicking(order.id));
  push('guard: completePicking refused while short', stillShort !== null);

  const overPick = await expectErr(() => svc.pick(order.id, { sku: SKU, qty: 2 }));
  push('guard: over-pick rejected (2+2 > 3)', overPick !== null && overPick.includes('超出'));

  const afterOver = await prisma.outboundItem.findFirstOrThrow({ where: { outboundOrderId: order.id } });
  push('atomicity: rejected over-pick left pickedQty at 2', afterOver.pickedQty === 2);

  const p2: any = await svc.pick(order.id, { sku: SKU, qty: 1 });
  push('pick: reaches required qty 3', p2.pickedQty === 3);
  push('pick: allPicked true once satisfied', p2.allPicked === true);

  // The moment of truth — no direct pickedQty write anywhere above.
  await svc.completePicking(order.id);
  const picked = await prisma.outboundOrder.findUniqueOrThrow({ where: { id: order.id } });
  push('LIFECYCLE: PICKING → PICKED with no direct DB write', picked.status === 'PICKED');

  await svc.startPacking(order.id);
  await svc.pack(order.id, { sku: SKU, qty: 3 });
  await svc.completePacking(order.id);
  await svc.ship(order.id);
  await svc.sign(order.id);
  const signed = await prisma.outboundOrder.findUniqueOrThrow({ where: { id: order.id } });
  push('LIFECYCLE: reaches SIGNED end-to-end', signed.status === 'SIGNED');

  const pickLogs = await prisma.operationLog.count({
    where: { entityType: 'OUTBOUND_ORDER', entityId: order.id, action: 'PICK' },
  });
  push('audit: one PICK row per successful pick (2)', pickLogs === 2);

  // ─── Outbound exception: OPEN → RESOLVED ─────────────────────────────
  const exOrder: any = await mkOrder();
  await svc.markException(exOrder.id, { type: 'SHORT_PICK', reason: 'E2E 异常关闭验证' });

  const list: any[] = await svc.exceptions();
  const mine = list.find((e) => e.orderNo === exOrder.orderNo);
  push('exception: created as OPEN', !!mine && mine.status === 'OPEN');

  const resolved: any = await svc.resolveException(mine.id, { resolution: '补货后重新拣货' });
  push('exception: OPEN → RESOLVED', resolved.status === 'RESOLVED');

  const reResolve = await expectErr(() => svc.resolveException(mine.id, {}));
  push('guard: re-resolve rejected', reResolve !== null && reResolve.includes('RESOLVED'));

  const parent = await prisma.outboundOrder.findUniqueOrThrow({ where: { id: exOrder.id } });
  push('exception: parent order deliberately untouched (still EXCEPTION)', parent.status === 'EXCEPTION');

  const exLogs = await prisma.operationLog.count({
    where: { entityType: 'OUTBOUND_EXCEPTION', entityId: mine.id, action: 'RESOLVE' },
  });
  push('audit: RESOLVE row written with the resolution note', exLogs === 1);

  // ─── Report ──────────────────────────────────────────────────────────
  console.log('=== sample ===');
  console.log(JSON.stringify({
    order: { orderNo: order.orderNo, finalStatus: signed.status },
    picks: [{ qty: 2, picked: p1.pickedQty, allPicked: p1.allPicked }, { qty: 1, picked: p2.pickedQty, allPicked: p2.allPicked }],
    rejections: { tooEarly, unknownSku, overPick, stillShort, reResolve },
    exception: { exceptionNo: resolved.exceptionNo, status: resolved.status, parentOrderStatus: parent.status },
  }, null, 2));
  console.log('');

  let allOk = true;
  for (const [name, ok] of checks) {
    console.log(`CROSS-CHECK ${name} -> ${ok ? 'PASS' : 'FAIL'}`);
    if (!ok) allOk = false;
  }

  await wipeDynamic(prisma, wh.id, cust.id);
  await prisma.$disconnect();
  console.log(`\n${allOk ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'} (${checks.length} checks)`);
  process.exit(allOk ? 0 : 1);
}

main().catch(async (e) => {
  console.error('VERIFY ERROR:', e?.message ?? e);
  process.exit(1);
});
