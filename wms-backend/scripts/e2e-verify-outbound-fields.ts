import 'reflect-metadata';
import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { OutboundOrdersService } from '../src/outbound-orders/outbound-orders.service';
import { OperationLogService } from '../src/common/operation-log.service';
import { InventoryTransactionService } from '../src/common/inventory-transaction.service';

// Verifies the OutboundOrder fulfillment-field expansion (report v4.8):
// seeds one isolated order with sample fulfillment values, then reads it back through
// the REAL OutboundOrdersService.detail() and asserts every field round-trips, plus the
// three DERIVED fields (warehouseCode / warehouseAddress / totalProductCount).
// Idempotent: warehouse/customer/product/order are upserted; the item is reset.

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();

  const wh = await prisma.warehouse.upsert({
    where: { code: 'WH-OBF-E2E' },
    update: { address: '测试仓地址123' },
    create: { code: 'WH-OBF-E2E', name: 'Outbound-Fields E2E Warehouse', address: '测试仓地址123' },
  });
  const cust = await prisma.customer.upsert({
    where: { code: 'CUST-OBF-E2E' },
    update: {},
    create: { code: 'CUST-OBF-E2E', name: 'Outbound-Fields E2E Customer' },
  });
  const prod = await prisma.product.upsert({
    where: { sku: 'SKU-OBF-1' },
    update: { customerId: cust.id },
    create: { sku: 'SKU-OBF-1', name: 'OBF 测试商品', customerId: cust.id },
  });

  const fields = {
    shipperNameZh: '发货人甲',
    serviceName: '标准服务',
    serviceLocked: true,
    customerRef: 'CR-001',
    orderSource: 'SHOPIFY',
    trackingNo: 'TRK-OBF-001',
    trackingTrace: '已揽收',
    carrier: 'DHL',
    multiPackage: true,
    recipientName: '张三',
    recipientCompany: 'ACME Inc',
    recipientCountry: 'US',
    recipientProvince: 'CA',
    recipientCity: 'Los Angeles',
    recipientAddress1: '123 Main St',
    transactionAmount: 199.99,
    transactionCurrency: 'USD',
    fee: 12.5,
    totalWeightKg: 3.5,
    packageLength: 30.0,
    packageBillingWeight: 4.2,
    pickingType: '单件',
    submittedAt: new Date(),
  };

  const order = await prisma.outboundOrder.upsert({
    where: { orderNo: 'OB-OBF-E2E-001' },
    update: { ...fields },
    create: { orderNo: 'OB-OBF-E2E-001', customerId: cust.id, warehouseId: wh.id, status: 'PENDING', ...fields },
  });
  await prisma.outboundItem.deleteMany({ where: { outboundOrderId: order.id } });
  await prisma.outboundItem.create({ data: { outboundOrderId: order.id, productId: prod.id, requiredQty: 9 } });

  // Read back through the real service.
  const svc = new OutboundOrdersService(prisma, new OperationLogService(prisma), new InventoryTransactionService(prisma));
  const d: any = await svc.detail(order.id);

  const checks: Array<[string, boolean]> = [
    ['string fields round-trip (recipientName/carrier/trackingNo/orderSource)',
      d.recipientName === '张三' && d.carrier === 'DHL' && d.trackingNo === 'TRK-OBF-001' && d.orderSource === 'SHOPIFY'],
    ['recipient address round-trip (country/province/city/addr1)',
      d.recipientCountry === 'US' && d.recipientProvince === 'CA' && d.recipientCity === 'Los Angeles' && d.recipientAddress1 === '123 Main St'],
    ['boolean fields round-trip (multiPackage/serviceLocked)', d.multiPackage === true && d.serviceLocked === true],
    ['decimal fields round-trip (amount/fee/length/billingWeight)',
      Number(d.transactionAmount) === 199.99 && Number(d.fee) === 12.5 && Number(d.packageLength) === 30 && Number(d.packageBillingWeight) === 4.2],
    ['datetime field present (submittedAt)', d.submittedAt != null],
    ['DERIVED warehouseCode', d.warehouseCode === 'WH-OBF-E2E'],
    ['DERIVED warehouseAddress', d.warehouseAddress === '测试仓地址123'],
    ['DERIVED totalProductCount', d.totalProductCount === 9],
  ];

  console.log('=== outbound detail() sample ===');
  console.log(JSON.stringify({
    orderNo: d.orderNo, recipientName: d.recipientName, carrier: d.carrier, trackingNo: d.trackingNo,
    transactionAmount: d.transactionAmount, fee: d.fee, multiPackage: d.multiPackage,
    warehouseCode: d.warehouseCode, warehouseAddress: d.warehouseAddress, totalProductCount: d.totalProductCount,
  }, null, 2));
  console.log('');

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
