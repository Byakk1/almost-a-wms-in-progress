// One-off E2E seed: a PENDING transit order with 1 item.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const wh = await prisma.warehouse.findFirst({ where: { code: 'WH-E2E-01' } });
  const cust = await prisma.customer.findFirst({ where: { code: 'CUST001' } });
  const prod = await prisma.product.findFirst({ where: { sku: 'SKU-ALPHA-001' } });
  if (!wh || !cust || !prod) throw new Error('prereq');

  const count = await prisma.transitOrder.count();
  const order = await prisma.transitOrder.create({
    data: {
      orderNo: `TR-E2E-${String(count + 1).padStart(4, '0')}`,
      customerId: cust.id,
      warehouseId: wh.id,
      status: 'PENDING',
      items: { create: [{ productId: prod.id, expectedQty: 15 }] },
    },
    include: { items: true },
  });

  process.stdout.write(JSON.stringify({ id: order.id, productId: prod.id, orderNo: order.orderNo, status: order.status }));
}

main().finally(() => prisma.$disconnect());
