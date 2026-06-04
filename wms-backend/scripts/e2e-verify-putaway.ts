// Verify side-effects after putaway: Inventory row + Location.status
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const loc = await prisma.location.findUnique({ where: { code: 'A-01-01' } });
  const inv = await prisma.inventory.findMany({
    where: { locationId: loc?.id },
    include: { product: { select: { sku: true } } },
  });
  process.stdout.write(JSON.stringify({
    location: { code: loc?.code, status: loc?.status },
    inventoryCount: inv.length,
    inventory: inv.map((i) => ({ sku: i.product.sku, batchNo: i.batchNo, availableQty: i.availableQty, totalQty: i.totalQty })),
  }, null, 2));
}

main().finally(() => prisma.$disconnect());
