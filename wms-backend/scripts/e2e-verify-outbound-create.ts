import 'reflect-metadata';
import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { OutboundOrdersService } from '../src/outbound-orders/outbound-orders.service';
import { OperationLogService } from '../src/common/operation-log.service';
import { InventoryTransactionService } from '../src/common/inventory-transaction.service';

// Verifies the outbound-order create / bulk-import path (report v4.9):
//   A. create() persists a PENDING order with OB-YYMMDD-NNNN number + nested items
//   B. fulfillment fields + derived fields round-trip through detail()
//   C. bulkCreate() reports created/total/orderNos/errors
//   D. relation guards reject bad customer / bad product with clean 4xx (no orphan rows)
// Fixtures are upserted; orders created during the run are deleted at the end.

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();

  const wh = await prisma.warehouse.upsert({
    where: { code: 'WH-OBC-E2E' },
    update: { address: '建单测试仓地址' },
    create: { code: 'WH-OBC-E2E', name: 'Outbound-Create E2E Warehouse', address: '建单测试仓地址' },
  });
  const cust = await prisma.customer.upsert({
    where: { code: 'CUST-OBC-E2E' },
    update: {},
    create: { code: 'CUST-OBC-E2E', name: 'Outbound-Create E2E Customer' },
  });
  const prod = await prisma.product.upsert({
    where: { sku: 'SKU-OBC-1' },
    update: { customerId: cust.id },
    create: { sku: 'SKU-OBC-1', name: 'OBC 测试商品', customerId: cust.id },
  });

  // Clean any leftovers from a prior run so counts are deterministic.
  await prisma.outboundOrder.deleteMany({ where: { customerId: cust.id } });

  const svc = new OutboundOrdersService(
    prisma,
    new OperationLogService(prisma),
    new InventoryTransactionService(prisma),
  );

  const checks: Array<[string, boolean]> = [];

  // ─── A. single create ──────────────────────────────────────────────
  const created: any = await svc.create({
    customerId: cust.id,
    warehouseId: wh.id,
    recipientName: '李四',
    recipientCountry: 'US',
    recipientCity: 'Seattle',
    recipientAddress1: '500 Pine St',
    carrier: 'UPS',
    trackingNo: 'TRK-OBC-001',
    orderSource: 'TIKTOK',
    serviceLocked: true,
    multiPackage: true,
    transactionAmount: 199.99,
    fee: 12.5,
    packageLength: 30,
    packageBillingWeight: 4.2,
    pickingType: '单件',
    items: [{ productId: prod.id, requiredQty: 3 }],
  } as any);

  checks.push(['create: orderNo matches OB-YYMMDD-NNNN', /^OB-\d{6}-\d{4}$/.test(created.orderNo)]);
  checks.push(['create: status PENDING', created.status === 'PENDING']);
  checks.push(['create: 1 item, requiredQty 3', created.items.length === 1 && created.items[0].requiredQty === 3]);

  // ─── B. detail round-trip ──────────────────────────────────────────
  const d: any = await svc.detail(created.id);
  checks.push(['detail: string/bool fields round-trip',
    d.recipientName === '李四' && d.carrier === 'UPS' && d.trackingNo === 'TRK-OBC-001' &&
    d.orderSource === 'TIKTOK' && d.serviceLocked === true && d.multiPackage === true]);
  checks.push(['detail: decimal fields round-trip',
    Number(d.transactionAmount) === 199.99 && Number(d.fee) === 12.5 &&
    Number(d.packageLength) === 30 && Number(d.packageBillingWeight) === 4.2]);
  checks.push(['detail: derived warehouseCode + totalProductCount',
    d.warehouseCode === 'WH-OBC-E2E' && d.totalProductCount === 3]);

  // ─── C. bulk import ────────────────────────────────────────────────
  const bulk: any = await svc.bulkCreate([
    { customerId: cust.id, warehouseId: wh.id, recipientName: '批量甲', items: [{ productId: prod.id, requiredQty: 1 }] },
    { customerId: cust.id, warehouseId: wh.id, recipientName: '批量乙', items: [{ productId: prod.id, requiredQty: 2 }] },
  ] as any);
  checks.push(['bulkCreate: created 2 / total 2 / 0 errors',
    bulk.created === 2 && bulk.total === 2 && bulk.errors.length === 0 && bulk.orderNos.length === 2]);

  // ─── D. relation guards (must throw, no order persisted) ───────────
  const ordersBeforeBad = await prisma.outboundOrder.count({ where: { customerId: cust.id } });

  let badProductRejected = false;
  try {
    await svc.create({ customerId: cust.id, warehouseId: wh.id, items: [{ productId: 'does-not-exist', requiredQty: 1 }] } as any);
  } catch (e: any) {
    badProductRejected = /商品不存在/.test(e?.message ?? '');
  }
  checks.push(['guard: unknown product rejected', badProductRejected]);

  let badCustomerRejected = false;
  try {
    await svc.create({ customerId: 'does-not-exist', warehouseId: wh.id, items: [{ productId: prod.id, requiredQty: 1 }] } as any);
  } catch (e: any) {
    badCustomerRejected = /客户不存在/.test(e?.message ?? '');
  }
  checks.push(['guard: unknown customer rejected', badCustomerRejected]);

  const ordersAfterBad = await prisma.outboundOrder.count({ where: { customerId: cust.id } });
  checks.push(['guard: rejected creates left no orphan orders', ordersAfterBad === ordersBeforeBad]);

  console.log('=== created order sample ===');
  console.log(JSON.stringify({
    orderNo: created.orderNo, status: created.status,
    recipientName: d.recipientName, carrier: d.carrier, trackingNo: d.trackingNo,
    transactionAmount: d.transactionAmount, fee: d.fee, multiPackage: d.multiPackage,
    warehouseCode: d.warehouseCode, totalProductCount: d.totalProductCount,
    bulkOrderNos: bulk.orderNos,
  }, null, 2));
  console.log('');

  let allOk = true;
  for (const [name, ok] of checks) {
    console.log(`CROSS-CHECK ${name} -> ${ok ? 'PASS' : 'FAIL'}`);
    if (!ok) allOk = false;
  }

  // Teardown: remove every order created for the test customer (items cascade).
  await prisma.outboundOrder.deleteMany({ where: { customerId: cust.id } });

  await prisma.$disconnect();
  console.log(`\n${allOk ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'}`);
  process.exit(allOk ? 0 : 1);
}

main().catch(async (e) => {
  console.error('VERIFY ERROR:', e?.message ?? e);
  process.exit(1);
});
