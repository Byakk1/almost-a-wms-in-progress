import 'reflect-metadata';
import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';

// Read-only inspection to base the putaway-rule seed on REAL data
// (warehouse codes, location zones, product itemTypes). Also confirms the
// PutawayRule table exists and is queryable.
async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();

  const warehouses = await prisma.warehouse.findMany({
    select: { id: true, code: true, name: true },
  });
  const zones = await prisma.location.groupBy({
    by: ['warehouseId', 'zone', 'status'],
    _count: true,
  });
  const itemTypes = await prisma.product.groupBy({
    by: ['itemType'],
    _count: true,
  });
  const pendingTasks = await prisma.putawayTask.count({ where: { status: 'PENDING' } });
  const emptyLocs = await prisma.location.count({ where: { status: 'EMPTY' } });
  const ruleCount = await prisma.putawayRule.count();

  console.log('=== Warehouses ===');
  console.log(JSON.stringify(warehouses, null, 2));
  console.log('=== Location zones (by warehouse + status) ===');
  console.log(JSON.stringify(zones, null, 2));
  console.log('=== Product itemTypes ===');
  console.log(JSON.stringify(itemTypes, null, 2));
  console.log(`\nPENDING putaway tasks: ${pendingTasks}`);
  console.log(`EMPTY locations: ${emptyLocs}`);
  console.log(`Existing PutawayRule rows: ${ruleCount}  (table is queryable -> DDL applied OK)`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('INSPECT ERROR:', e?.message ?? e);
  process.exit(1);
});
