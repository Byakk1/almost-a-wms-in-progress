import 'reflect-metadata';
import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { InventoryService } from '../src/inventory/inventory.service';
import { DashboardService } from '../src/dashboard/dashboard.service';
import { OperationLogService } from '../src/common/operation-log.service';
import { InventoryTransactionService } from '../src/common/inventory-transaction.service';

// Verifies the MockDb -> Prisma migration of InventoryService + DashboardService
// by invoking the REAL service classes against the live database.
async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();

  // InventoryService now writes an OperationLog + InventoryTransaction on adjust(),
  // so it takes both audit collaborators. This script only exercises the read paths.
  const inventory = new InventoryService(
    prisma,
    new OperationLogService(prisma),
    new InventoryTransactionService(prisma),
  );
  const dashboard = new DashboardService(prisma);

  const [invSummary, invList, stats, util, todos, trend] = await Promise.all([
    inventory.summary(),
    inventory.list({ page: 1, pageSize: 5 }),
    dashboard.stats(),
    dashboard.warehouseUtilization(),
    dashboard.todos(),
    dashboard.trend(7),
  ]);

  console.log('=== inventory.summary ===');
  console.log(JSON.stringify(invSummary, null, 2));
  console.log('=== inventory.list (total + first 3 rows) ===');
  console.log(JSON.stringify({ total: invList.pagination.total, sample: invList.data.slice(0, 3) }, null, 2));
  console.log('=== dashboard.stats ===');
  console.log(JSON.stringify(stats, null, 2));
  console.log('=== dashboard.warehouseUtilization ===');
  console.log(JSON.stringify(util, null, 2));
  console.log('=== dashboard.todos ===');
  console.log(JSON.stringify(todos, null, 2));
  console.log('=== dashboard.trend(7) ===');
  console.log(JSON.stringify(trend, null, 2));

  // Cross-check: inventory.summary totals must agree with a raw aggregate over the
  // same Prisma rows that Putaway writes (proves no split-brain with a Mock array).
  const raw = await prisma.inventory.aggregate({ _sum: { totalQty: true }, _count: true });
  const ok = (invSummary.totalQty ?? 0) === (raw._sum.totalQty ?? 0);
  console.log(`\nCROSS-CHECK inventory.summary.totalQty(${invSummary.totalQty}) === raw _sum(${raw._sum.totalQty}) over ${raw._count} rows -> ${ok ? 'PASS' : 'FAIL'}`);

  await prisma.$disconnect();
  process.exit(ok ? 0 : 1);
}

main().catch(async (e) => {
  console.error('VERIFY ERROR:', e?.message ?? e);
  process.exit(1);
});
