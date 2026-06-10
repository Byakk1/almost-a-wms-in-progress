import 'reflect-metadata';
import 'dotenv/config';
import * as XLSX from 'xlsx';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Import a fulfillment-export .xlsx ("orders" sheet) into the WMS.
 *
 * The file carries external CODES (海外仓代码 / 发货人 / SKU 编码), not WMS internal IDs,
 * and the WMS may not yet hold that master data. So this importer is self-contained:
 *   1. upsert Customer (by 发货人ID), Warehouse (by 海外仓代码), Product (by SKU) from the file
 *   2. group rows by 仓库出库单号 → create OutboundOrder (status PENDING) + line items
 * Idempotent: master data is upserted; orders whose orderNo already exists are skipped.
 *
 * Usage:  npx ts-node scripts/import-fulfillment-xlsx.ts [<path>] [--commit]
 *   default = DRY-RUN (no writes). Pass --commit to write.
 *
 * Deliberately skipped (Karpathy: only what's needed): date columns (创建/提交/出库时间),
 * 出库数量 (PENDING import → picked/packed start at 0), SKU ID, and the fee's embedded
 * currency (费用 "1.04CAD" → fee 1.04, currency dropped). 账单信息 sheet is out of scope.
 */

const FILE = process.argv.find((a) => /\.xlsx$/i.test(a)) || 'C:/Users/Administrator/Desktop/fulfillment_20260608.xlsx';
const COMMIT = process.argv.includes('--commit');

// "orders" sheet column indices
const C = {
  shipperId: 0, shipperZh: 1, shipperEn: 2, service: 3, customerRef: 4, sourceOrderNo: 5,
  orderNo: 6, inboundNo: 7, tracking: 9, tracking1: 10, multiPkg: 11,
  zip: 12, country: 13, province: 14, city: 15, fee: 16, totalWeight: 17, totalVol: 18,
  pkgActWeight: 19, pkgBillWeight: 20, pkgActVol: 21, platformCode: 22, whCode: 23, whAddr: 24,
  orderSource: 25, pickingType: 29, sku: 30, qty: 32, nameZh: 34, nameEn: 35,
  declValue: 36, currency: 37, shippingBag: 38, weight: 39, weightUnit: 40,
};

const s = (v: any): string | undefined => { const t = String(v ?? '').trim(); return t === '' ? undefined : t; };
const num = (v: any): number | undefined => { const t = String(v ?? '').trim(); if (t === '') return undefined; const n = parseFloat(t); return Number.isFinite(n) ? n : undefined; };
const yes = (v: any): boolean => s(v) === '是';

async function main() {
  const wb = XLSX.readFile(FILE);
  const sheet = wb.Sheets['orders'];
  if (!sheet) throw new Error('找不到 "orders" 工作表');
  const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
  const all = rows.slice(1);
  const body = all.filter((r) => s(r[C.orderNo]) && s(r[C.sku]) && num(r[C.qty]) !== undefined);
  const dropped = all.length - body.length;

  // ── master data (dedup) ──
  const custKey = (r: any[]) => s(r[C.shipperId]) ?? s(r[C.shipperZh]) ?? 'UNKNOWN';
  const customers = new Map<string, { code: string; name: string }>();
  const warehouses = new Map<string, { code: string; name: string; address?: string }>();
  const products = new Map<string, any>();

  for (const r of body) {
    const ck = custKey(r);
    if (!customers.has(ck)) customers.set(ck, { code: ck, name: s(r[C.shipperZh]) ?? s(r[C.shipperEn]) ?? ck });
    const wc = s(r[C.whCode]);
    if (wc && !warehouses.has(wc)) warehouses.set(wc, { code: wc, name: wc, address: s(r[C.whAddr]) });
    const sku = s(r[C.sku])!;
    if (!products.has(sku)) products.set(sku, {
      sku, customerCode: ck,
      name: s(r[C.nameZh]) ?? s(r[C.nameEn]) ?? sku, nameZh: s(r[C.nameZh]), nameEn: s(r[C.nameEn]),
      declaredValue: num(r[C.declValue]), currency: s(r[C.currency]) ?? 'USD',
      weight: num(r[C.weight]), weightUnit: (s(r[C.weightUnit]) ?? 'kg').toLowerCase(),
      hasShippingBag: yes(r[C.shippingBag]), warehouseCodes: s(r[C.whCode]),
    });
  }

  const orders = new Map<string, any[][]>();
  for (const r of body) {
    const k = s(r[C.orderNo])!;
    (orders.get(k) ?? orders.set(k, []).get(k)!).push(r);
  }

  console.log(`FILE : ${FILE}`);
  console.log(`MODE : ${COMMIT ? '*** COMMIT (writes enabled) ***' : 'DRY-RUN (no writes)'}`);
  console.log(`rows : ${body.length} valid line rows (${dropped} dropped: missing orderNo/SKU/qty)`);
  console.log(`plan : ${orders.size} orders | upsert ${customers.size} customers, ${warehouses.size} warehouses, ${products.size} products`);

  const prisma = new PrismaService();
  await prisma.$connect();

  const existing = new Set(
    (await prisma.outboundOrder.findMany({ where: { orderNo: { in: [...orders.keys()] } }, select: { orderNo: true } })).map((o) => o.orderNo),
  );
  console.log(`already in DB (will skip): ${existing.size}`);

  if (!COMMIT) {
    const [k, rs] = [...orders][0];
    const h = rs[0];
    console.log('\n--- sample order mapping (first order) ---');
    console.log(`orderNo      : ${k}`);
    console.log(`customer     : ${custKey(h)} / ${s(h[C.shipperZh])}`);
    console.log(`warehouse    : ${s(h[C.whCode])}`);
    console.log(`recipient    : ${s(h[C.city])}, ${s(h[C.province])}, ${s(h[C.country])} ${s(h[C.zip])}`);
    console.log(`service/track: ${s(h[C.service])} / ${s(h[C.tracking])}`);
    console.log(`fee          : ${num(h[C.fee])}  totalWeightKg: ${num(h[C.totalWeight])}  multiPackage: ${yes(h[C.multiPkg])}`);
    console.log(`lines        : ${rs.map((r) => `${s(r[C.sku])}×${num(r[C.qty])}`).join(', ')}`);
    const multi = [...orders.values()].filter((v) => v.length > 1).length;
    console.log(`\norders with >1 line: ${multi}`);
    console.log('DRY-RUN complete — no writes. Re-run with --commit to apply.');
    await prisma.$disconnect();
    return;
  }

  // ── COMMIT ──
  const custId = new Map<string, string>();
  for (const c of customers.values()) {
    const row = await prisma.customer.upsert({ where: { code: c.code }, update: { name: c.name }, create: { code: c.code, name: c.name } });
    custId.set(c.code, row.id);
  }
  const whId = new Map<string, string>();
  for (const w of warehouses.values()) {
    const row = await prisma.warehouse.upsert({ where: { code: w.code }, update: { address: w.address }, create: { code: w.code, name: w.name, address: w.address } });
    whId.set(w.code, row.id);
  }
  const prodId = new Map<string, string>();
  for (const p of products.values()) {
    const data = {
      name: p.name, nameZh: p.nameZh, nameEn: p.nameEn, declaredValue: p.declaredValue,
      currency: p.currency, weight: p.weight, weightUnit: p.weightUnit,
      hasShippingBag: p.hasShippingBag, warehouseCodes: p.warehouseCodes,
    };
    const row = await prisma.product.upsert({ where: { sku: p.sku }, update: data, create: { sku: p.sku, customerId: custId.get(p.customerCode)!, ...data } });
    prodId.set(p.sku, row.id);
  }
  console.log(`upserted: ${custId.size} customers, ${whId.size} warehouses, ${prodId.size} products`);

  let created = 0, skipped = 0;
  const errors: string[] = [];
  for (const [orderNo, rs] of orders) {
    if (existing.has(orderNo)) { skipped++; continue; }
    try {
      const h = rs[0];
      const itemQty = new Map<string, number>();
      for (const r of rs) { const sku = s(r[C.sku])!; itemQty.set(sku, (itemQty.get(sku) ?? 0) + (num(r[C.qty]) ?? 1)); }
      const items = [...itemQty].map(([sku, qty]) => ({ productId: prodId.get(sku)!, requiredQty: Math.max(1, Math.round(qty)) }));
      await prisma.outboundOrder.create({
        data: {
          orderNo, status: 'PENDING',
          customerId: custId.get(custKey(h))!, warehouseId: whId.get(s(h[C.whCode])!)!,
          shipperId: s(h[C.shipperId]), shipperNameZh: s(h[C.shipperZh]), shipperNameEn: s(h[C.shipperEn]), serviceName: s(h[C.service]),
          customerRef: s(h[C.customerRef]), platformRef: s(h[C.sourceOrderNo]), platformCode: s(h[C.platformCode]),
          orderSource: s(h[C.orderSource]), inboundOrderNo: s(h[C.inboundNo]),
          trackingNo: s(h[C.tracking]), trackingNo1: s(h[C.tracking1]), multiPackage: yes(h[C.multiPkg]),
          recipientZip: s(h[C.zip]), recipientCountry: s(h[C.country]), recipientProvince: s(h[C.province]), recipientCity: s(h[C.city]),
          fee: num(h[C.fee]), totalWeightKg: num(h[C.totalWeight]), totalVolumeCbm: num(h[C.totalVol]),
          packageActualWeight: num(h[C.pkgActWeight]), packageBillingWeight: num(h[C.pkgBillWeight]), packageActualVolume: num(h[C.pkgActVol]),
          pickingType: s(h[C.pickingType]),
          items: { create: items },
        },
      });
      created++;
    } catch (e: any) { errors.push(`${orderNo}: ${e.message}`); }
  }
  console.log(`\nORDERS: created ${created}, skipped ${skipped} (pre-existing), errors ${errors.length}`);
  if (errors.length) console.log(errors.slice(0, 10).join('\n'));
  await prisma.$disconnect();
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
