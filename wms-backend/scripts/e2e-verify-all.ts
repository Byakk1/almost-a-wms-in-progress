import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const locs = await prisma.location.findMany({ orderBy: { code: 'asc' } });
  const inv = await prisma.inventory.findMany({
    include: { product: { select: { sku: true } }, location: { select: { code: true } } },
  });

  const out = {
    locations: locs.map((l) => ({ code: l.code, status: l.status })),
    inventoryCount: inv.length,
    inventory: inv.map((i) => ({
      sku: i.product.sku,
      location: i.location.code,
      availableQty: i.availableQty,
      batchNo: i.batchNo,
    })),
  };
  process.stdout.write(JSON.stringify(out, null, 2));
}

main().finally(() => prisma.$disconnect());
