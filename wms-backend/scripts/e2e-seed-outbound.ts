// One-off E2E seed for outbound: outbound order PENDING with 2 items.
// Items are pre-picked (pickedQty=requiredQty) so complete-picking can succeed
// without a real picking flow.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const warehouse = await prisma.warehouse.findFirst({ where: { code: 'WH-E2E-01' } });
  const customer = await prisma.customer.findFirst({ where: { code: 'CUST001' } });
  const productA = await prisma.product.findFirst({ where: { sku: 'SKU-ALPHA-001' } });
  const productB = await prisma.product.findFirst({ where: { sku: 'SKU-BETA-001' } });
  if (!warehouse || !customer || !productA || !productB) throw new Error('missing prerequisites');

  const count = await prisma.outboundOrder.count();
  const orderNo = `OUT-E2E-${String(count + 1).padStart(4, '0')}`;

  const order = await prisma.outboundOrder.create({
    data: {
      orderNo,
      customerId: customer.id,
      warehouseId: warehouse.id,
      status: 'PENDING',
      items: {
        create: [
          { productId: productA.id, requiredQty: 20, pickedQty: 20 },
          { productId: productB.id, requiredQty: 10, pickedQty: 10 },
        ],
      },
    },
    include: { items: true },
  });

  console.log(JSON.stringify({ orderId: order.id, orderNo: order.orderNo, status: order.status, items: order.items.length }, null, 2));
}

main().finally(() => prisma.$disconnect());
