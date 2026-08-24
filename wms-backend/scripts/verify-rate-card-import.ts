import 'reflect-metadata';
import 'dotenv/config';
import * as XLSX from 'xlsx';
import { PrismaService } from '../src/prisma/prisma.service';
import { RateCardsService } from '../src/rate-cards/rate-cards.service';
import { OperationLogService } from '../src/common/operation-log.service';
import { grid } from './import-rate-card';
import { CARRIERS, parseMatrix, parseZones } from './import-rate-card-shipping';

// Post-import verification for the SHIPPING cards.
//
//   npx ts-node scripts/verify-rate-card-import.ts "<path to workbook>"
//
// Read-only: it writes nothing and prints no prices, only whether the engine's
// answer matches the workbook's.
//
// Re-parsing the sheet and diffing it against the database would only prove the
// importer is self-consistent. This instead drives the REAL quote path end to end
//   sheet cell  →  zone table  →  postcode  →  quote()  →  amount
// so a mistake anywhere in that chain — a mis-keyed column, a band boundary off
// by one, a zone resolving to the wrong origin — shows up as a mismatch.
//
// Samples are spread deterministically across the bands and zones of each carrier
// rather than taken at random, so a re-run checks the same cells and a regression
// cannot hide behind a lucky draw.

const SAMPLES_PER_CARRIER = 24;

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('用法: npx ts-node scripts/verify-rate-card-import.ts "<价卡 xlsx 路径>"');
    process.exit(2);
  }

  const wb = XLSX.readFile(file);
  const prisma = new PrismaService();
  await prisma.$connect();
  const svc = new RateCardsService(prisma, new OperationLogService(prisma));

  let checked = 0;
  let failed = 0;
  const misses: string[] = [];

  for (const spec of CARRIERS) {
    const rateRows = grid(wb, spec.rateSheet);
    const zoneRows = grid(wb, spec.zoneSheet);
    const m = parseMatrix(rateRows, spec);
    const zones = parseZones(zoneRows, spec);

    const card = await prisma.rateCard.findFirst({ where: { name: spec.card } });
    if (!card) { console.log(`  ✗ ${spec.card}: 数据库中找不到该价卡`); failed++; continue; }

    const dbItems = await prisma.rateCardItem.count({ where: { rateCardId: card.id } });
    const dbZones = await prisma.shippingZone.count({ where: { rateCardId: card.id } });
    const itemsOk = dbItems === m.items.length;
    const zonesOk = dbZones === zones.length;

    // A postcode that actually resolves to each zone, per origin.
    const byZone = new Map<string, { origin: string; destination: string }>();
    for (const z of zones) {
      if (!byZone.has(z.zone)) byZone.set(z.zone, { origin: z.origin ?? '', destination: z.destination });
    }

    // Real priced bands only — the synthesized open 面议 band has no sheet cell to
    // compare against.
    const priced = m.items.filter((i) => !i.quoteOnRequest && i.unitPrice !== undefined);
    const step = Math.max(1, Math.floor(priced.length / SAMPLES_PER_CARRIER));

    let cardFail = 0;
    let sampled = 0;
    for (let n = 0; n < priced.length && sampled < SAMPLES_PER_CARRIER; n += step) {
      const it = priced[n];
      const loc = byZone.get(it.zone!);
      if (!loc) {
        misses.push(`${spec.card} 分区 ${it.zone} 在分区表中没有任何邮编`);
        cardFail++; sampled++; continue;
      }

      // Probe just inside the band's lower bound: the boundary is the value most
      // likely to be off by one, and rangeStart is inclusive.
      const value = Number(it.rangeStart ?? 0);
      try {
        const q = await svc.quote({
          type: 'SHIPPING', carrier: spec.carrier,
          destination: loc.destination, origin: loc.origin, value,
        });
        checked++; sampled++;
        const zoneMatch = q.zone === it.zone;
        const priceMatch = Number(q.unitPrice) === Number(it.unitPrice);
        if (!zoneMatch || !priceMatch) {
          cardFail++;
          misses.push(
            `${spec.card} ${loc.origin}/${loc.destination} @${value}kg → ` +
            `分区 期望 ${it.zone} 实得 ${q.zone}；单价${priceMatch ? '一致' : '不一致'}`,
          );
        }
      } catch (e: any) {
        checked++; sampled++; cardFail++;
        misses.push(`${spec.card} ${loc.origin}/${loc.destination} @${value}kg → 报错: ${e.message}`);
      }
    }

    failed += cardFail;
    console.log(
      `  ${cardFail === 0 && itemsOk && zonesOk ? '✓' : '✗'} ${spec.card.padEnd(22)}` +
      ` 明细 ${dbItems}/${m.items.length}${itemsOk ? '' : ' ✗'}` +
      `  分区 ${dbZones}/${zones.length}${zonesOk ? '' : ' ✗'}` +
      `  抽查 ${sampled} 项，${cardFail} 项不符`,
    );
    if (!itemsOk) failed++;
    if (!zonesOk) failed++;
  }

  // The top band is synthesized, so it deserves its own check: a parcel heavier
  // than the carrier prices must come back as 面议 with a NULL amount, never 0.
  const cp = await prisma.rateCard.findFirst({ where: { name: '加拿大邮政 Expedited' } });
  if (cp) {
    const z = await prisma.shippingZone.findFirst({ where: { rateCardId: cp.id } });
    if (z) {
      const over = await svc.quote({
        type: 'SHIPPING', carrier: 'CANADAPOST',
        destination: z.destination, origin: z.origin, value: 500,
      });
      const ok = over.quoteOnRequest === true && over.amount === null;
      console.log(`  ${ok ? '✓' : '✗'} 超限包裹(500kg) → 面议且金额为 null（不是 0）`);
      if (!ok) failed++;
    }
  }

  console.log(`\n抽查 ${checked} 项，${failed} 项不符。`);
  misses.slice(0, 15).forEach((m) => console.log(`  ⚠ ${m}`));
  if (misses.length > 15) console.log(`  …另有 ${misses.length - 15} 条`);

  await prisma.$disconnect();
  console.log(failed === 0 ? 'IMPORT VERIFIED' : 'IMPORT VERIFICATION FAILED');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('VERIFY ERROR:', e?.message ?? e);
  process.exit(1);
});
