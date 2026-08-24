import 'reflect-metadata';
import 'dotenv/config';
import * as XLSX from 'xlsx';
import { PrismaService } from '../src/prisma/prisma.service';
import { RateCardsService } from '../src/rate-cards/rate-cards.service';
import { OperationLogService } from '../src/common/operation-log.service';
import { RateCardItemDto, ShippingZoneDto } from '../src/rate-cards/dto/create-rate-card.dto';
import { S, grid, parsePrice, round3, sheetEffectiveDate } from './import-rate-card';

// Rate card importer — Group B (the SHIPPING sheets).
//
//   npx ts-node scripts/import-rate-card-shipping.ts "<path to workbook>"            # DRY RUN
//   npx ts-node scripts/import-rate-card-shipping.ts "<path to workbook>" --commit   # writes
//
// The workbook path is an ARGUMENT and must live OUTSIDE the repo. This file is
// code; the prices it reads are not, and neither mode writes anything to disk.
//
// ── Shape ─────────────────────────────────────────────────────────────
//
// A shipping sheet is a MATRIX, not a list: rows are weight bands, columns are
// zone codes, and each cell is one price. Importing it means pivoting — one
// RateCardItem per (row × column) — which is why these four sheets produce
// roughly as many rows as everything else in the workbook combined times a
// hundred.
//
// Pricing needs TWO lookups, so each carrier contributes two tables:
//   · the rate matrix   → RateCardItem (zone + weight band → price)
//   · the zone table    → ShippingZone (postcode prefix → zone, PER ORIGIN)
//
// ── Traps ─────────────────────────────────────────────────────────────
//
// · Every sheet stacks several tables. Below the matrix sit numbered surcharge
//   notes and a provincial tax table whose cells are percentages. Reading to the
//   last row ingests "5%" as a weight band, so each matrix stops at the first row
//   whose From column is not a number.
// · Zone tables carry one column PER ORIGIN (多伦多 / 温哥华) and the same postcode
//   maps to a different zone in each. That is what ShippingZone.origin is for.
// · Intelcom pairs each origin with a LINEHAUL code column; only ZONE is a rate
//   dimension.
// · Purolator lays its zone table out as two side-by-side tables, each with its
//   own postcode column.
// · Purolator prices in POUNDS: its kg bands are converted values carrying twelve
//   decimals. Tier bounds are stored at 6dp for exactly this reason.
// · CPC Return Service has NO zones and only an upper bound per row. It is not a
//   zone-priced service, so it is imported as EXTRA weight tiers rather than
//   SHIPPING — activate() rightly refuses a SHIPPING card with no zone table.
// · Top bands are closed (the service refuses heavier parcels), so an open 面议
//   band is appended per the agreed rule.

const TAG = '[运费导入]';
const CHUNK = 1000;

export type CarrierSpec = {
  card: string;
  carrier: string;
  rateSheet: string;
  zoneSheet: string;
  /** Column holding the band lower bound in the rate matrix. */
  fromCol: number;
  /** First zone column in the rate matrix. */
  firstZoneCol: number;
  /** (postcodeCol, zoneCol, originLabel) triples in the zone sheet. */
  zoneCols: Array<[number, number, string]>;
  /** Row index (0-based) of the zone sheet's first data row. */
  zoneDataFrom: number;
};

// Column positions are hard-coded per carrier on purpose: each sheet has a
// different header layout, and a heuristic that guesses them would fail silently
// on the one sheet it guessed wrong.
export const CARRIERS: CarrierSpec[] = [
  {
    card: '加拿大邮政 Expedited', carrier: 'CANADAPOST',
    rateSheet: '加拿大邮政Canadapost Expedited', zoneSheet: '加拿大邮政分区表',
    fromCol: 1, firstZoneCol: 3,
    zoneCols: [[1, 2, '多伦多'], [1, 3, '温哥华']],
    zoneDataFrom: 5,
  },
  {
    card: 'Intelcom Dragonfly', carrier: 'INTELCOM',
    rateSheet: '加拿大Intelcom(Dragonfly)', zoneSheet: '加拿大Intelcom Dragonfly分区表',
    // col D is UP TO (LB) — a reference column, not a zone.
    fromCol: 1, firstZoneCol: 4,
    zoneCols: [[1, 2, '温哥华'], [1, 4, '多伦多']],
    zoneDataFrom: 5,
  },
  {
    card: 'Purolator Ground', carrier: 'PUROLATOR',
    rateSheet: '加拿大Purolator Ground', zoneSheet: 'Purolator分区表',
    fromCol: 1, firstZoneCol: 4,
    // two side-by-side tables, each with its OWN postcode column
    zoneCols: [[1, 2, '多伦多'], [5, 6, '温哥华']],
    zoneDataFrom: 4,
  },
];

const num = (v: any): number | null => {
  const t = S(v);
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** Header row of a rate matrix: the row carrying From (kg) / To (kg). */
function findMatrixHeader(rows: any[][]): number {
  const i = rows.findIndex((r) => r.some((c) => /^From\s*\(kg\)/i.test(S(c))));
  if (i < 0) throw new Error('找不到 From (kg) 表头行');
  return i;
}

/**
 * Pivot one carrier's matrix into per-zone weight bands.
 *
 * Stops at the first row whose From cell is not numeric — that is where the
 * matrix ends and the surcharge notes / tax table begin.
 */
export function parseMatrix(rows: any[][], spec: CarrierSpec) {
  const h = findMatrixHeader(rows);
  const header = rows[h];

  const zones: Array<{ col: number; zone: string }> = [];
  for (let c = spec.firstZoneCol; c < header.length; c++) {
    const z = S(header[c]);
    if (z) zones.push({ col: c, zone: z });
  }
  if (!zones.length) throw new Error('表头未解析到任何分区列');

  const bands: Array<{ from: number; to: number | null; row: any[] }> = [];
  for (const r of rows.slice(h + 1)) {
    const from = num(r[spec.fromCol]);
    if (from === null) break; // end of the matrix
    const to = num(r[spec.fromCol + 1]);
    bands.push({ from, to, row: r });
  }
  if (!bands.length) throw new Error('未解析到任何重量档');

  const items: RateCardItemDto[] = [];
  let priced = 0;
  let blank = 0;
  const livedZones = new Set<string>();
  const emptyZones: string[] = [];

  for (const { col, zone } of zones) {
    const zoneItems: RateCardItemDto[] = [];
    bands.forEach((b) => {
      const price = parsePrice(b.row[col]);
      if (!price) { blank++; return; }
      // The sheet's own From values are used as-is rather than re-derived from the
      // previous band: if the card really does contain a gap, activate() must see
      // it and refuse, not have it silently closed by the importer.
      zoneItems.push({
        zone,
        tierBasis: 'WEIGHT_KG',
        rangeStart: round6(b.from),
        rangeEnd: b.to === null ? undefined : round6(b.to + 0.001),
        chargeUnit: 'PER_ORDER',
        unitPrice: price.unitPrice,
        quoteOnRequest: price.quoteOnRequest,
        note: price.note,
      });
    });

    // A header cell with nothing priced beneath it is not a zone. The sheets park
    // footnotes in the header row ("该价格已包含提货费…"), and treating one as a
    // zone code would invent a zone the carrier does not have — which then shows
    // up as a phantom mismatch against the zone table.
    if (!zoneItems.length) { emptyZones.push(zone); continue; }

    priced += zoneItems.length;
    livedZones.add(zone);
    items.push(...zoneItems);

    // Closed top band → the service refuses heavier parcels; append an open 面议
    // band so they return "needs a manual quote" instead of no price at all.
    const last = zoneItems[zoneItems.length - 1];
    if (last.rangeEnd !== undefined) {
      items.push({
        zone,
        tierBasis: 'WEIGHT_KG',
        rangeStart: last.rangeEnd,
        rangeEnd: undefined,
        chargeUnit: 'PER_ORDER',
        quoteOnRequest: true,
        note: '超出价卡最高重量档，需人工报价（价卡本身未列此区间）',
      });
    }
  }

  return {
    items, zoneCodes: livedZones, bandCount: bands.length, priced, blank,
    emptyZones,
  };
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Zone table → one row per (origin, postcode). */
export function parseZones(rows: any[][], spec: CarrierSpec) {
  const out: ShippingZoneDto[] = [];
  const seen = new Set<string>();
  for (const r of rows.slice(spec.zoneDataFrom)) {
    for (const [pcCol, zCol, origin] of spec.zoneCols) {
      const pc = S(r[pcCol]).replace(/\s+/g, '').toUpperCase();
      const zone = S(r[zCol]);
      // Header remnants and the 省州 columns are text but not postcodes.
      if (!pc || !zone || !/^[A-Z0-9]{1,7}$/.test(pc)) continue;
      if (/邮编|分区|ZONE$|省州/.test(S(r[pcCol]))) continue;
      const key = `${origin}|${pc}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ origin, destination: pc, zone });
    }
  }
  return out;
}

/** CPC Return Service — no zones, only an upper bound per row. */
function parseCpcReturn(wb: XLSX.WorkBook, fallback: string) {
  const rows = grid(wb, '加拿大 CPC Return Service');
  const h = rows.findIndex((r) => r.some((c) => /Weight\s*Up\s*To/i.test(S(c))));
  if (h < 0) throw new Error('CPC Return：找不到表头');

  const items: RateCardItemDto[] = [];
  let cursor = 0;
  let last: RateCardItemDto | null = null;
  for (const r of rows.slice(h + 1)) {
    const upTo = num(r[1]);
    if (upTo === null) break;
    const price = parsePrice(r[2]);
    if (!price) continue;
    const end = round6(upTo + 0.001);
    const item: RateCardItemDto = {
      itemCode: 'CPC_RETURN', itemName: 'CPC 退件服务',
      tierBasis: 'WEIGHT_KG',
      rangeStart: round6(cursor), rangeEnd: end,
      chargeUnit: 'PER_ORDER',
      unitPrice: price.unitPrice, quoteOnRequest: price.quoteOnRequest, note: price.note,
    };
    items.push(item); last = item; cursor = end;
  }
  if (!items.length) throw new Error('CPC Return：未解析到任何重量档');

  if (last && (last as RateCardItemDto).rangeEnd !== undefined) {
    items.push({
      itemCode: 'CPC_RETURN', itemName: 'CPC 退件服务（超出价卡上限）',
      tierBasis: 'WEIGHT_KG',
      rangeStart: (last as RateCardItemDto).rangeEnd, rangeEnd: undefined,
      chargeUnit: 'PER_ORDER', quoteOnRequest: true,
      note: '超出价卡最高重量档，需人工报价',
    });
  }

  return {
    // EXTRA, not SHIPPING: it has no zone table, and activate() rightly refuses a
    // SHIPPING card that cannot resolve a postcode to a zone.
    name: 'CPC 退件服务', type: 'EXTRA',
    effectiveAt: sheetEffectiveDate(rows, fallback), items,
  };
}

async function main() {
  const file = process.argv[2];
  const commit = process.argv.includes('--commit');
  if (!file) {
    console.error('用法: npx ts-node scripts/import-rate-card-shipping.ts "<价卡 xlsx 路径>" [--commit]');
    process.exit(2);
  }
  if (/cherry logistics platform/i.test(file.replace(/\\/g, '/'))) {
    console.error('拒绝执行：价卡文件不得放在代码仓库目录内。请从仓库外的路径读取。');
    process.exit(2);
  }

  const wb = XLSX.readFile(file);
  const fallback = sheetEffectiveDate(grid(wb, '目录'), new Date().toISOString());
  console.log(`${TAG} 模式: ${commit ? '写入数据库 (--commit)' : '试运行 DRY RUN（不写任何数据）'}\n`);

  type Job = {
    name: string; type: string; carrier?: string; effectiveAt: string;
    items: RateCardItemDto[]; zones: ShippingZoneDto[]; problems: string[];
  };
  const jobs: Job[] = [];

  for (const spec of CARRIERS) {
    const rateRows = grid(wb, spec.rateSheet);
    const zoneRows = grid(wb, spec.zoneSheet);
    const m = parseMatrix(rateRows, spec);
    const zones = parseZones(zoneRows, spec);

    // The cross-check that matters: a zone priced in the matrix but missing from
    // the zone table is a runtime 404 on a real customer order, and nothing else
    // in the stack would catch it.
    const mapped = new Set(zones.map((z) => z.zone));
    const unmapped = [...m.zoneCodes].filter((z) => !mapped.has(z));
    const unpriced = [...mapped].filter((z) => !m.zoneCodes.has(z));
    const problems: string[] = [];
    if (unmapped.length) problems.push(`矩阵中有 ${unmapped.length} 个分区在分区表里找不到: ${unmapped.slice(0, 8).join(',')}`);
    if (unpriced.length) problems.push(`分区表中有 ${unpriced.length} 个分区在矩阵里没有价格: ${unpriced.slice(0, 8).join(',')}`);

    const origins = [...new Set(zones.map((z) => z.origin))];
    console.log(
      `  · ${spec.card.padEnd(22)} 重量档 ${String(m.bandCount).padStart(3)} × 分区 ${String(m.zoneCodes.size).padStart(3)}` +
      ` → 明细 ${String(m.items.length).padStart(5)}   分区行 ${String(zones.length).padStart(5)}（发货仓 ${origins.join('/')}）`,
    );
    if (m.blank) console.log(`      空价格单元格 ${m.blank} 个（已跳过）`);
    if (m.emptyZones.length) {
      console.log(`      表头有 ${m.emptyZones.length} 列无任何价格，判定为非分区列（多为脚注），已忽略`);
    }
    problems.forEach((p) => console.log(`      ⚠ ${p}`));

    jobs.push({
      name: spec.card, type: 'SHIPPING', carrier: spec.carrier,
      effectiveAt: sheetEffectiveDate(rateRows, fallback),
      items: m.items, zones, problems,
    });
  }

  const cpc = parseCpcReturn(wb, fallback);
  console.log(`  · ${cpc.name.padEnd(22)} 明细 ${cpc.items.length}（无分区，按 EXTRA 重量梯度导入）`);
  jobs.push({ ...cpc, zones: [], problems: [] });

  const totalItems = jobs.reduce((s, j) => s + j.items.length, 0);
  const totalZones = jobs.reduce((s, j) => s + j.zones.length, 0);
  console.log(`\n${TAG} 合计 明细 ${totalItems} 条 / 分区 ${totalZones} 行`);

  const blocked = jobs.filter((j) => j.problems.length);
  if (blocked.length) {
    console.log(`${TAG} ⚠ ${blocked.length} 张价卡存在分区对不上的问题，见上方警告。`);
  }

  if (!commit) {
    console.log(`\n${TAG} 试运行结束，未写入任何数据。确认无误后加 --commit 重跑。`);
    process.exit(0);
  }

  const prisma = new PrismaService();
  await prisma.$connect();
  const svc = new RateCardsService(prisma, new OperationLogService(prisma));

  let activated = 0;
  for (const j of jobs) {
    const existing = await prisma.rateCard.findMany({ where: { name: j.name }, select: { id: true } });
    if (existing.length) {
      await prisma.rateCard.deleteMany({ where: { id: { in: existing.map((e) => e.id) } } });
      console.log(`  ↻ 覆盖已存在的价卡 ${j.name}`);
    }

    const card = await svc.create({
      name: j.name, type: j.type, carrier: j.carrier, currency: 'CAD',
      isDefault: true, effectiveAt: j.effectiveAt,
    });

    for (let i = 0; i < j.zones.length; i += CHUNK) {
      await svc.addZones(card.id, { zones: j.zones.slice(i, i + CHUNK) });
    }
    for (let i = 0; i < j.items.length; i += CHUNK) {
      await svc.addItems(card.id, { items: j.items.slice(i, i + CHUNK) });
    }

    try {
      await svc.activate(card.id);
      activated++;
      console.log(`  ✓ ${j.name} 已启用（明细 ${j.items.length} / 分区 ${j.zones.length}）`);
    } catch (e: any) {
      console.error(`  ✗ ${j.name} 启用失败，保留为草稿: ${e.message}`);
    }
  }

  console.log(`\n${TAG} 完成：${jobs.length} 张价卡写入，${activated} 张通过梯度校验并启用。`);
  await prisma.$disconnect();
  process.exit(activated === jobs.length ? 0 : 1);
}

// Guarded so the verifier can reuse CARRIERS / parseMatrix / parseZones without
// this script's main() firing on import.
if (require.main === module) {
  main().catch((e) => {
    console.error('IMPORT ERROR:', e?.message ?? e);
    process.exit(1);
  });
}
