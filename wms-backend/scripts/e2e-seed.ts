// One-off E2E seed: warehouse + a PENDING receiving order with two items.
// Run via: npx ts-node scripts/e2e-seed.ts
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const warehouse = await prisma.warehouse.upsert({
    where: { code: 'WH-E2E-01' },
    update: {},
    create: { code: 'WH-E2E-01', name: 'E2E Test Warehouse', address: 'localhost' },
  });

  const customer = await prisma.customer.findFirst({ where: { code: 'CUST001' } });
  const productA = await prisma.product.findFirst({ where: { sku: 'SKU-ALPHA-001' } });
  const productB = await prisma.product.findFirst({ where: { sku: 'SKU-BETA-001' } });
  if (!customer || !productA || !productB) throw new Error('missing seed prerequisites');

  const count = await prisma.receivingOrder.count();
  const receivingNo = `IN-E2E-${String(count + 1).padStart(4, '0')}`;

  const order = await prisma.receivingOrder.create({
    data: {
      receivingNo,
      customerId: customer.id,
      warehouseId: warehouse.id,
      trackingNo: 'TRK-E2E-001',
      expectedQuantity: 30,
      status: 'PENDING',
      items: {
        create: [
          { productId: productA.id, expectedQty: 20 },
          { productId: productB.id, expectedQty: 10 },
        ],
      },
    },
    include: { items: true },
  });

  console.log(JSON.stringify({ warehouseId: warehouse.id, orderId: order.id, receivingNo: order.receivingNo, status: order.status, items: order.items.length }, null, 2));
}

main().finally(() => prisma.$disconnect());
