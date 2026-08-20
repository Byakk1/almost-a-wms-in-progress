import 'reflect-metadata';
import 'dotenv/config';
import * as XLSX from 'xlsx';
import { PrismaService } from '../src/prisma/prisma.service';
import { RateCardsService } from '../src/rate-cards/rate-cards.service';
import { OperationLogService } from '../src/common/operation-log.service';
import { RateCardItemDto } from '../src/rate-cards/dto/create-rate-card.dto';

// Rate card importer — Group A (the non-shipping sheets).
//
//   npx ts-node scripts/import-rate-card.ts "<path to workbook>"            # DRY RUN
//   npx ts-node scripts/import-rate-card.ts "<path to workbook>" --commit   # writes
//
// The workbook path is an ARGUMENT and must live OUTSIDE the repo. Commercial rate
// cards are never committed — this file is code, the prices it reads are not. It
// writes nothing to disk in either mode; --commit writes to the database only.
//
// Cards are created as DRAFT and activated at the end, so the tier validation in
// RateCardsService.activate runs against the real data. Re-running replaces the
// cards it owns (matched by name) rather than duplicating them.
//
// ── Things the real workbook does that the naive reader gets wrong ──
//
// · Bands are written (a, b] — "0＜X≤0.5" — exclusive start, INCLUSIVE end. Our
//   model is [start, end). Normalising with a 0.001 step reproduces the card's
//   intent exactly; the workbook's own shipping sheets already use that step
//   (0.101 / 25.001 / 27.501), so it is the card's convention, not our invention.
// · A price cell is not always a number: "by case", "详细请咨询客服", "实报实销"
//   (billed at cost) and "见仓租费用" (cross-reference) all appear. Every one
//   becomes quoteOnRequest with the original text kept in `note` — never 0.
// · A price cell can carry its own unit: a "<n>/kg" cell is PER_KG while every other
//   band on the same table is PER_ITEM. chargeUnit is therefore per-item.
// · Top bands are closed (…≤100kg). Per the agreed rule an open 面议 band is
//   appended, so heavier goods return "needs a manual quote" instead of no price.
// · Each sheet carries its OWN 报价生效期, older than the cover date. The sheet's
//   own date is used; the cover date is only a fallback.
// · 海外仓收货异常 is NOT a price sheet — it is an exception-handling policy
//   table with no prices at all, and is deliberately not imported.

const TAG = '[价卡导入]';
const DELTA = 0.001; // smallest step at Decimal(12,3) — the workbook's own granularity

type Parsed = {
  name: string;
  type: string;
  effectiveAt: string;
  items: RateCardItemDto[];
  note?: string;
};

// ─── cell helpers ─────────────────────────────────────────────────────

const S = (v: any) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Non-numeric price forms that must become 面议 rather than 0. */
const QUOTE_TEXTS = ['by case', '详细请咨询客服', '实报实销', '见仓租费用', '面议'];

type Price = { unitPrice?: number; quoteOnRequest?: boolean; chargeUnit?: string; note?: string };

function parsePrice(raw: any): Price | null {
  const t = S(raw);
  if (!t) return null;
  if (QUOTE_TEXTS.some((q) => t.toLowerCase().includes(q.toLowerCase()))) {
    return { quoteOnRequest: true, note: t };
  }
  // "<n>/kg" — the cell carries its own charge unit
  const perUnit = t.match(/^([\d.]+)\s*\/\s*(kg|item|箱|件|托)$/i);
  if (perUnit) {
    return { unitPrice: Number(perUnit[1]), chargeUnit: mapUnit(perUnit[2]) };
  }
  const n = Number(t.replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(n)) return { quoteOnRequest: true, note: t };
  return { unitPrice: n };
}

const UNIT_MAP: Record<string, string> = {
  托: 'PER_PALLET', 托盘: 'PER_PALLET',
  箱: 'PER_CARTON', 纸箱: 'PER_CARTON',
  件: 'PER_ITEM', item: 'PER_ITEM', sku: 'PER_ITEM',
  张: 'PER_LABEL',
  kg: 'PER_KG',
  '20gp': 'PER_CONTAINER', '40gp': 'PER_CONTAINER',
  '40hq': 'PER_CONTAINER', '45hq': 'PER_CONTAINER',
};

function mapUnit(raw: any, fallback = 'PER_ITEM'): string {
  const t = S(raw).toLowerCase();
  return UNIT_MAP[t] ?? fallback;
}

/**
 * Band text → (gt, lte].  Handles the full-width comparison signs the workbook
 * uses, plus the plain "0-15 days" / "8-30自然天" forms.
 */
function parseBand(raw: any): { gt: number; lte: number | null } | null {
  const t = S(raw).replace(/[＜<]/g, '<').replace(/[＞>]/g, '>').replace(/[≤]/g, '<=').replace(/[≥]/g, '>=');
  let m = t.match(/^([\d.]+)\s*<\s*X\s*<=\s*([\d.]+)/i);
  if (m) return { gt: Number(m[1]), lte: Number(m[2]) };
  m = t.match(/^X\s*>\s*([\d.]+)/i);
  if (m) return { gt: Number(m[1]), lte: null };
  // "0-15 days" / "8-30自然天" — inclusive both ends, day counts
  m = t.match(/^(\d+)\s*[-—~]\s*(\d+)/);
  if (m) return { gt: Number(m[1]) - 1, lte: Number(m[2]) };
  m = t.match(/^(\d+)\s*(?:天|days?)?\s*(?:以上|\+)/i);
  if (m) return { gt: Number(m[1]), lte: null };
  return null;
}

/**
 * (a, b] bands → contiguous [start, end) bands our engine can match.
 *
 * The first band starts at 0 (activate() requires it); every later band starts
 * where the previous one ended; each end is the card's inclusive bound + one step,
 * so a parcel weighing exactly the bound still falls in the band the card put it in.
 * If the top band is closed, an open 面议 band is appended.
 */
function normaliseBands(
  rows: Array<{ band: { gt: number; lte: number | null }; price: Price }>,
  tierBasis: string,
  defaultUnit: string,
  itemCode: string,
  itemName: string,
): RateCardItemDto[] {
  const out: RateCardItemDto[] = [];
  let cursor = 0;

  rows.forEach((r, i) => {
    const isLast = i === rows.length - 1;
    const end = r.band.lte === null ? undefined : round3(r.band.lte + DELTA);
    out.push({
      itemCode, itemName,
      tierBasis,
      rangeStart: round3(cursor),
      rangeEnd: isLast && r.band.lte === null ? undefined : end,
      chargeUnit: r.price.chargeUnit ?? defaultUnit,
      unitPrice: r.price.unitPrice,
      quoteOnRequest: r.price.quoteOnRequest,
      note: r.price.note,
    });
    if (end !== undefined) cursor = end;
  });

  const top = out[out.length - 1];
  if (top && top.rangeEnd !== undefined) {
    out.push({
      itemCode, itemName: `${itemName}（超出价卡上限）`,
      tierBasis,
      rangeStart: top.rangeEnd,
      rangeEnd: undefined,
      chargeUnit: top.chargeUnit,
      quoteOnRequest: true,
      note: '超出价卡最高档，需人工报价（价卡本身未列此区间）',
    });
  }
  return out;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Each sheet carries its own 报价生效期; the cover date is the fallback. */
function sheetEffectiveDate(rows: any[][], fallback: string): string {
  for (const r of rows.slice(0, 6)) {
    for (const c of r) {
      const m = S(c).match(/生效期[:：]\s*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
      if (m) return new Date(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}T00:00:00Z`).toISOString();
    }
  }
  return fallback;
}

const grid = (wb: XLSX.WorkBook, name: string): any[][] =>
  XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, blankrows: false, defval: '' });

// ─── sheet parsers ────────────────────────────────────────────────────
// One per sheet, deliberately explicit: every sheet has a different shape and a
// generic engine would only hide that.

/** 一件代发仓租 — day bands run across the COLUMNS of a single data row. */
function parseDropshipStorage(wb: XLSX.WorkBook, fallback: string): Parsed {
  const rows = grid(wb, '一件代发仓租');
  const header = rows.find((r) => r.some((c) => parseBand(c) && /day|天/i.test(S(c))));
  const data = header ? rows[rows.indexOf(header) + 1] : undefined;
  if (!header || !data) throw new Error('一件代发仓租：找不到梯度表头');

  const bands: Array<{ band: any; price: Price }> = [];
  header.forEach((h, i) => {
    const band = parseBand(h);
    const price = parsePrice(data[i]);
    if (band && price) bands.push({ band, price });
  });
  if (!bands.length) throw new Error('一件代发仓租：未解析到任何梯度');

  return {
    name: '一件代发仓租',
    type: 'STORAGE',
    effectiveAt: sheetEffectiveDate(rows, fallback),
    items: normaliseBands(bands, 'STORAGE_DAYS', 'PER_CBM_DAY', 'STORAGE_DROPSHIP', '一件代发仓租'),
  };
}

/** FBA移仓退货报价 → 仓租费（FBA转运）: day bands run down the ROWS. */
function parseFbaStorage(wb: XLSX.WorkBook, fallback: string): Parsed {
  const rows = grid(wb, 'FBA移仓退货报价');
  const bands: Array<{ band: any; price: Price }> = [];
  for (const r of rows) {
    for (let i = 0; i < r.length - 1; i++) {
      const band = parseBand(r[i]);
      if (!band || !/天|day/i.test(S(r[i]))) continue;
      const price = parsePrice(r[i + 1]);
      if (price) bands.push({ band, price });
      break;
    }
  }
  if (!bands.length) throw new Error('FBA移仓退货报价：未解析到仓租梯度');

  return {
    name: 'FBA转运仓租',
    type: 'STORAGE',
    effectiveAt: sheetEffectiveDate(rows, fallback),
    items: normaliseBands(bands, 'STORAGE_DAYS', 'PER_CBM_DAY', 'STORAGE_FBA', 'FBA转运仓租'),
    note: '与「一件代发仓租」是两套不同的库龄档位，故分列两张价卡',
  };
}

/** 增值服务费 — flat named services; 服务类型 is a merged group label. */
function parseVas(wb: XLSX.WorkBook, fallback: string): Parsed {
  const rows = grid(wb, '增值服务费');
  const h = rows.findIndex((r) => r.some((c) => S(c) === '收费项目') && r.some((c) => /计费单位/.test(S(c))));
  if (h < 0) throw new Error('增值服务费：找不到表头');
  const col = {
    group: rows[h].findIndex((c) => /服务类型/.test(S(c))),
    name: rows[h].findIndex((c) => S(c) === '收费项目'),
    price: rows[h].findIndex((c) => /费用/.test(S(c))),
    unit: rows[h].findIndex((c) => /计费单位/.test(S(c))),
    note: rows[h].findIndex((c) => /说明|备注/.test(S(c))),
  };

  const items: RateCardItemDto[] = [];
  let group = '';
  let lastName = '';
  for (const r of rows.slice(h + 1)) {
    if (/^(服务说明|备注)/.test(S(r[col.group] ?? r[1]))) break;
    if (col.group >= 0 && S(r[col.group])) group = S(r[col.group]);
    const nm = S(r[col.name]) || lastName; // r20 continues 包材费 with a blank name
    const price = parsePrice(r[col.price]);
    if (!nm || !price) continue;
    lastName = nm;
    const unitText = S(r[col.unit]);
    items.push({
      itemCode: `VAS_${items.length + 1}`,
      itemName: group ? `${group} / ${nm}` : nm,
      chargeUnit: price.chargeUnit ?? mapUnit(unitText),
      unitPrice: price.unitPrice,
      quoteOnRequest: price.quoteOnRequest,
      note: [unitText && `单位:${unitText}`, price.note, S(r[col.note]).slice(0, 180)]
        .filter(Boolean).join(' | ') || undefined,
    });
  }
  if (!items.length) throw new Error('增值服务费：未解析到任何服务项');

  return { name: '增值服务费', type: 'EXTRA', effectiveAt: sheetEffectiveDate(rows, fallback), items };
}

/** 退货回仓服务 — weight bands across the COLUMNS, one data row. */
function parseReturns(wb: XLSX.WorkBook, fallback: string): Parsed {
  const rows = grid(wb, '退货回仓服务');
  const header = rows.find((r) => r.filter((c) => parseBand(c)).length >= 3);
  const data = header ? rows[rows.indexOf(header) + 1] : undefined;
  if (!header || !data) throw new Error('退货回仓服务：找不到梯度表头');

  const bands: Array<{ band: any; price: Price }> = [];
  header.forEach((h, i) => {
    const band = parseBand(h);
    const price = parsePrice(data[i]);
    if (band && price) bands.push({ band, price });
  });

  return {
    name: '退货回仓服务',
    type: 'EXTRA',
    effectiveAt: sheetEffectiveDate(rows, fallback),
    items: normaliseBands(bands, 'WEIGHT_KG', 'PER_ITEM', 'RETURN_RECEIVE', S(data[1]) || '未妥投退货接收费'),
  };
}

/**
 * The 卸货费 block — identical shape in 一件代发订单处理费 and FBA转运库内费用:
 * 服务名称 | 费用名称 | 计费单位 | 费用 | 备注, where 计费单位 may be a container code.
 */
function parseUnloading(rows: any[][], prefix: string): RateCardItemDto[] {
  const h = rows.findIndex((r) => S(r[1]) === '服务名称' && r.some((c) => /计费单位/.test(S(c))));
  if (h < 0) return [];
  const items: RateCardItemDto[] = [];
  let feeName = '';
  for (const r of rows.slice(h + 1)) {
    const unitText = S(r[3]);
    const price = parsePrice(r[4]);
    if (/说明$/.test(S(r[1])) || /^入库处理费/.test(S(r[1]))) break;
    if (S(r[2])) feeName = S(r[2]);
    if (!unitText || !price) continue;
    items.push({
      itemCode: `${prefix}_UNLOAD_${unitText.toUpperCase().replace(/[^A-Z0-9]/g, '') || items.length}`,
      itemName: [S(r[1]), feeName, unitText].filter(Boolean).join(' / '),
      chargeUnit: price.chargeUnit ?? mapUnit(unitText, 'PER_CARTON'),
      unitPrice: price.unitPrice,
      quoteOnRequest: price.quoteOnRequest,
      note: [price.note, S(r[5]).slice(0, 180)].filter(Boolean).join(' | ') || undefined,
    });
  }
  return items;
}

/**
 * 一件代发订单处理费 — three tables in one sheet: the 卸货费 block, then INBOUND
 * (cols B–D) and OUTBOUND (cols E–G) weight tiers sitting SIDE BY SIDE on the
 * same rows.
 */
function parseDropshipHandling(wb: XLSX.WorkBook, fallback: string): Parsed {
  const rows = grid(wb, '一件代发订单处理费');
  const items = parseUnloading(rows, 'DS');

  const side = (bandCol: number, priceCol: number, code: string, label: string) => {
    const bands: Array<{ band: any; price: Price }> = [];
    for (const r of rows) {
      const band = parseBand(r[bandCol]);
      const price = parsePrice(r[priceCol]);
      if (band && price) bands.push({ band, price });
    }
    return bands.length ? normaliseBands(bands, 'WEIGHT_KG', 'PER_ITEM', code, label) : [];
  };

  items.push(...side(2, 3, 'INBOUND_HANDLING', '入库处理费（一件代发）'));
  items.push(...side(5, 6, 'OUTBOUND_HANDLING', '出库处理费（一件代发）'));

  if (!items.length) throw new Error('一件代发订单处理费：未解析到任何计费项');
  return { name: '一件代发操作费', type: 'FULFILLMENT', effectiveAt: sheetEffectiveDate(rows, fallback), items };
}

/**
 * Rows belonging to one titled section: from the title down to the next title or
 * the first 说明 block. Needed because FBA转运库内费用 stacks 入库处理费 and
 * 出库处理费 in the SAME column — an unbounded scan merges them into one tier
 * set, producing overlapping bands under a single itemCode.
 */
function sliceSection(rows: any[][], title: RegExp): any[][] {
  const s = rows.findIndex((r) => r.some((c) => title.test(S(c))));
  if (s < 0) return [];
  const rest = rows.slice(s + 1);
  const e = rest.findIndex((r) =>
    r.some((c) => /说明\s*[:：]/.test(S(c)) || /^(入库处理费|出库处理费|自提订单)/.test(S(c))),
  );
  return e < 0 ? rest : rest.slice(0, e);
}

/** Collect (band, price) pairs from a bounded section at fixed columns. */
function bandsIn(section: any[][], bandCol: number, priceCol: number) {
  const out: Array<{ band: any; price: Price }> = [];
  for (const r of section) {
    const band = parseBand(r[bandCol]);
    const price = parsePrice(r[priceCol]);
    if (band && price) out.push({ band, price });
  }
  return out;
}

/**
 * FBA转运库内费用 — 卸货费 block, then THREE more tables:
 *   入库处理费（FBA转运）        weight tiers, CAD/箱
 *   出库处理费（FBA快递转运）    weight tiers, CAD/箱
 *   出库处理费（FBA卡派转运）    NOT a tier — 2 scenario prices against 5 bands,
 *                               so it is imported as flat per-pallet items
 *   自提订单特殊处理费           flat items
 */
function parseFbaHandling(wb: XLSX.WorkBook, fallback: string): Parsed {
  const rows = grid(wb, 'FBA转运库内费用');
  const items = parseUnloading(rows, 'FBA');

  const inbound = bandsIn(sliceSection(rows, /^入库处理费/), 1, 2);
  if (inbound.length) {
    items.push(...normaliseBands(inbound, 'WEIGHT_KG', 'PER_CARTON', 'FBA_INBOUND_HANDLING', '入库处理费（FBA转运）'));
  }

  const outSection = sliceSection(rows, /^出库处理费/);
  const outbound = bandsIn(outSection, 1, 2);
  if (outbound.length) {
    items.push(...normaliseBands(outbound, 'WEIGHT_KG', 'PER_CARTON', 'FBA_OUTBOUND_EXPRESS', '出库处理费（FBA快递转运）'));
  }

  // 卡派 sits in the next column of the same rows but is populated on only two of
  // them, each with a 备注 describing a SCENARIO rather than a weight range.
  // Reading it as a tier would invent bands the card never priced.
  outSection.forEach((r) => {
    const price = parsePrice(r[3]);
    if (!price || price.unitPrice === undefined) return;
    items.push({
      itemCode: `FBA_OUTBOUND_TRUCK_${items.length}`,
      itemName: `出库处理费（FBA卡派转运）${S(r[4]) ? ` / ${S(r[4]).slice(0, 40)}` : ''}`,
      chargeUnit: 'PER_PALLET',
      unitPrice: price.unitPrice,
      note: ['按场景计价，非重量梯度', S(r[4]).slice(0, 180)].filter(Boolean).join(' | '),
    });
  });

  // 自提订单特殊处理费 — 费用 | 计费单位 | 费用(CAD) | 备注
  for (const r of sliceSection(rows, /^自提订单特殊处理费/)) {
    const nm = S(r[1]);
    const price = parsePrice(r[3]);
    if (!nm || /^费用$/.test(nm) || !price || price.unitPrice === undefined) continue;
    items.push({
      itemCode: `FBA_PICKUP_${items.length}`,
      itemName: nm,
      chargeUnit: mapUnit(S(r[2]).replace(/^散货,?\s*\/?/, ''), 'PER_CARTON'),
      unitPrice: price.unitPrice,
      note: [S(r[2]) && `单位:${S(r[2])}`, S(r[4]).slice(0, 180)].filter(Boolean).join(' | ') || undefined,
    });
  }

  if (!items.length) throw new Error('FBA转运库内费用：未解析到任何计费项');
  return { name: 'FBA转运操作费', type: 'FULFILLMENT', effectiveAt: sheetEffectiveDate(rows, fallback), items };
}

// ─── main ─────────────────────────────────────────────────────────────

async function main() {
  const file = process.argv[2];
  const commit = process.argv.includes('--commit');
  if (!file) {
    console.error('用法: npx ts-node scripts/import-rate-card.ts "<价卡 xlsx 路径>" [--commit]');
    process.exit(2);
  }
  if (/cherry logistics platform/i.test(file.replace(/\\/g, '/'))) {
    console.error('拒绝执行：价卡文件不得放在代码仓库目录内。请从仓库外的路径读取。');
    process.exit(2);
  }

  const wb = XLSX.readFile(file);
  const cover = grid(wb, '目录');
  const fallbackDate = sheetEffectiveDate(cover, new Date().toISOString());
  console.log(`${TAG} 封面报价生效期: ${fallbackDate.slice(0, 10)}`);
  console.log(`${TAG} 模式: ${commit ? '写入数据库 (--commit)' : '试运行 DRY RUN（不写任何数据）'}\n`);

  const parsers = [
    parseDropshipStorage, parseFbaStorage, parseVas,
    parseReturns, parseDropshipHandling, parseFbaHandling,
  ];

  const parsed: Parsed[] = [];
  let failed = 0;
  for (const p of parsers) {
    try {
      parsed.push(p(wb, fallbackDate));
    } catch (e: any) {
      failed++;
      console.error(`  ✗ ${p.name}: ${e.message}`);
    }
  }

  console.log(`${TAG} 解析结果`);
  for (const c of parsed) {
    const qor = c.items.filter((i) => i.quoteOnRequest).length;
    const tiers = c.items.filter((i) => (i.tierBasis ?? 'NONE') !== 'NONE').length;
    console.log(
      `  · ${c.name.padEnd(14)} ${c.type.padEnd(12)} 生效 ${c.effectiveAt.slice(0, 10)}` +
      `  明细 ${String(c.items.length).padStart(3)}（梯度 ${tiers} / 面议 ${qor}）`,
    );
  }

  // Show one worked example so a misparse is visible without opening the DB.
  const sample = parsed.find((c) => c.items.some((i) => i.tierBasis !== 'NONE'));
  if (sample) {
    console.log(`\n${TAG} 抽样（${sample.name} 前 4 档，验证区间归一化）`);
    sample.items.filter((i) => i.tierBasis !== 'NONE').slice(0, 4).forEach((i) => {
      console.log(`    [${i.rangeStart ?? 0}, ${i.rangeEnd ?? '∞'})  ${i.chargeUnit}  ` +
        `${i.quoteOnRequest ? '面议' : i.unitPrice}`);
    });
  }

  if (!commit) {
    console.log(`\n${TAG} 试运行结束，未写入任何数据。确认无误后加 --commit 重跑。`);
    console.log(`${TAG} 解析失败 ${failed} 张。`);
    process.exit(failed ? 1 : 0);
  }

  const prisma = new PrismaService();
  await prisma.$connect();
  const svc = new RateCardsService(prisma, new OperationLogService(prisma));

  let activated = 0;
  for (const c of parsed) {
    // Re-runnable: drop the card this importer owns before recreating it.
    const existing = await prisma.rateCard.findMany({ where: { name: c.name }, select: { id: true } });
    if (existing.length) {
      await prisma.rateCard.deleteMany({ where: { id: { in: existing.map((e) => e.id) } } });
      console.log(`  ↻ 覆盖已存在的价卡 ${c.name}（${existing.length} 张）`);
    }
    const created = await svc.create({
      name: c.name, type: c.type, currency: 'CAD', isDefault: true,
      effectiveAt: c.effectiveAt, note: c.note, items: c.items,
    });
    try {
      await svc.activate(created.id);
      activated++;
      console.log(`  ✓ ${c.name} 已启用（${c.items.length} 条明细）`);
    } catch (e: any) {
      console.error(`  ✗ ${c.name} 启用失败，保留为草稿: ${e.message}`);
    }
  }

  console.log(`\n${TAG} 完成：${parsed.length} 张价卡写入，${activated} 张通过梯度校验并启用。`);
  await prisma.$disconnect();
  process.exit(activated === parsed.length && !failed ? 0 : 1);
}

main().catch((e) => {
  console.error('IMPORT ERROR:', e?.message ?? e);
  process.exit(1);
});
