import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function main() {
  const dictByCategory = await prisma.dictionary.groupBy({
    by: ['category'],
    _count: { _all: true },
    orderBy: { category: 'asc' },
  });
  console.log('— Dictionary categories (after seed) —');
  for (const r of dictByCategory) console.log(`  ${r.category.padEnd(20)} ${r._count._all}`);
  console.log(`  TOTAL: ${dictByCategory.reduce((s, r) => s + r._count._all, 0)} rows\n`);

  const productCount = await prisma.product.count();
  const batteryCount = await prisma.productBattery.count();
  const inventoryCount = await prisma.inventory.count();
  const opLogCount = await prisma.operationLog.count();
  const invTxCount = await prisma.inventoryTransaction.count();
  const exceptionCount = await prisma.exceptionCase.count();

  console.log('— Table row counts —');
  console.log(`  Product:               ${productCount}`);
  console.log(`  ProductBattery:        ${batteryCount}`);
  console.log(`  Inventory:             ${inventoryCount}`);
  console.log(`  OperationLog:          ${opLogCount}`);
  console.log(`  InventoryTransaction:  ${invTxCount}`);
  console.log(`  ExceptionCase:         ${exceptionCount}`);

  const sampleProduct = await prisma.product.findFirst({
    select: { sku: true, nameZh: true, hsCode: true, weight: true, currency: true, batteryConfig: true },
  });
  console.log('\n— Sample product (first row) —');
  console.log(sampleProduct ?? '  (table empty)');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => void prisma.$disconnect());
