import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';

// Seed QUALIFIED inventory behind every PENDING outbound order so they can be allocated/
// picked/shipped. One seed Location per warehouse; one Inventory row per (wh,cust,product)
// with generous availableQty. Idempotent: re-runs top up rather than duplicate.
async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();

  const orders = await prisma.outboundOrder.findMany({ where: { status: 'PENDING' }, include: { items: true } });
  console.log('PENDING orders:', orders.length);

  const whIds = [...new Set(orders.map((o) => o.warehouseId))];
  const locByWh = new Map<string, string>();
  for (const wid of whIds) {
    const code = `SEED-LOC-${wid.slice(-6)}`;
    const loc = await prisma.location.upsert({
      where: { code },
      update: {},
      create: { code, warehouseId: wid, zone: 'SEED' },
    });
    locByWh.set(wid, loc.id);
  }

  let created = 0, toppedUp = 0;
  for (const o of orders) {
    for (const it of o.items) {
      const existing = await prisma.inventory.findFirst({
        where: { warehouseId: o.warehouseId, customerId: o.customerId, productId: it.productId, inventoryStatus: 'QUALIFIED' },
      });
      if (existing) {
        if (existing.availableQty < it.requiredQty) {
          await prisma.inventory.update({
            where: { id: existing.id },
            data: { availableQty: existing.availableQty + 1000, totalQty: existing.totalQty + 1000 },
          });
          toppedUp++;
        }
        continue;
      }
      await prisma.inventory.create({
        data: {
          warehouseId: o.warehouseId, customerId: o.customerId, productId: it.productId,
          locationId: locByWh.get(o.warehouseId)!,
          availableQty: 1000, totalQty: 1000, inventoryStatus: 'QUALIFIED',
          inboundDate: new Date('2026-06-01T00:00:00Z'), unit: 'pcs',
        },
      });
      created++;
    }
  }
  console.log(`locations: ${locByWh.size} | inventory created: ${created} | topped-up: ${toppedUp}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
