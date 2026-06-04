// Seed: a Location in WH-E2E-01 so we can putaway into it.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const wh = await prisma.warehouse.findFirst({ where: { code: 'WH-E2E-01' } });
  if (!wh) throw new Error('warehouse missing');

  const loc = await prisma.location.upsert({
    where: { code: 'A-01-01' },
    update: {},
    create: { code: 'A-01-01', warehouseId: wh.id, zone: 'A', row: '01', col: 1, status: 'EMPTY' },
  });

  const pendingTask = await prisma.putawayTask.findFirst({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
  });

  process.stdout.write(JSON.stringify({
    locationId: loc.id,
    locationCode: loc.code,
    pendingTaskId: pendingTask?.id ?? null,
    pendingTaskNo: pendingTask?.taskNo ?? null,
  }));
}

main().finally(() => prisma.$disconnect());
