// One-off: create a fresh PENDING outbound order and print only its id.
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

  const count = await prisma.outboundOrder.count();
  const order = await prisma.outboundOrder.create({
    data: {
      orderNo: `OUT-E2E-EX-${String(count + 1).padStart(4, '0')}`,
      customerId: cust.id,
      warehouseId: wh.id,
      status: 'PENDING',
      items: { create: [{ productId: prod.id, requiredQty: 5 }] },
    },
  });
  process.stdout.write(order.id);
}

main().finally(() => prisma.$disconnect());
