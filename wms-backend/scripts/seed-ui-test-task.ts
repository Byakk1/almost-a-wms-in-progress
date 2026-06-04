// Seed: a fresh PENDING PutawayTask for UI testing. Reuses existing IN-E2E-0001 receiving order.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const ro = await prisma.receivingOrder.findFirst({ where: { receivingNo: 'IN-E2E-0001' } });
  const product = await prisma.product.findFirst({ where: { sku: 'SKU-ALPHA-001' } });
  if (!ro || !product) throw new Error('prereq');

  const count = await prisma.putawayTask.count();
  const task = await prisma.putawayTask.create({
    data: {
      taskNo: `PT-UI-${String(count + 1).padStart(3, '0')}`,
      receivingOrderId: ro.id,
      productId: product.id,
      warehouseId: ro.warehouseId,
      qty: 5,
      status: 'PENDING',
    },
  });
  process.stdout.write(JSON.stringify({ id: task.id, taskNo: task.taskNo, sku: product.sku, qty: task.qty }));
}

main().finally(() => prisma.$disconnect());
