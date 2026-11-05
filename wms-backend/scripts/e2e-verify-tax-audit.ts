import 'reflect-metadata';
import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { BillsService } from '../src/bills/bills.service';
import { RateCardsService } from '../src/rate-cards/rate-cards.service';
import { OperationLogService } from '../src/common/operation-log.service';

// ADVERSARIAL tax audit (E4, report v4.42). Independent of e2e-verify-billing:
// every expected figure below is derived BY HAND from the seeded public-law
// TaxRate table and the PRD's rules, then compared with the engine. The point is
// to REFUTE the engine, not to re-assert its own output. Cases the main suite
// does not cover: BC (GST+PST two lines), NS rate-change boundary (15%→14% at
// 2025-04-01 — exercises the two NS rows and the period-end resolution), a
// mixed-country month, per-event vs whole-month rounding, fuel leakage before
// finalize, and a forced double-finalize ledger attack.
//
// ⚠ Synthetic prices only (freight 10, handling 4). Own fixture: ADV-E4-*.

const CUST = 'CUST-ADV-E4';
const WH = 'WH-ADV-E4';
const TAG = 'ADV-E4';
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

async function wipe(prisma: PrismaService, custId: string) {
  const bills = await prisma.customerBill.findMany({ where: { customerId: custId }, select: { id: true } });
  await prisma.customerBill.deleteMany({ where: { customerId: custId } });
  await prisma.operationLog.deleteMany({ where: { entityType: 'CustomerBill', entityId: { in: bills.map((b) => b.id) } } });
  await prisma.customerTransaction.deleteMany({ where: { customerId: custId } });
  await prisma.outboundOrder.deleteMany({ where: { customerId: custId } });
  const cards = await prisma.rateCard.findMany({ where: { name: { startsWith: TAG } }, select: { id: true } });
  await prisma.rateCard.deleteMany({ where: { id: { in: cards.map((c) => c.id) } } });
  await prisma.customer.update({ where: { id: custId }, data: { balance: 0 } });
}

async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  const cust = await prisma.customer.upsert({ where: { code: CUST }, update: {}, create: { code: CUST, name: 'Adversarial Tax E2E', balance: 0 } });
  const wh = await prisma.warehouse.upsert({ where: { code: WH }, update: {}, create: { code: WH, name: 'Adv E4 WH', address: 'CA/BC/Test//1 Rd///V6B1A1' } });
  await wipe(prisma, cust.id);

  const opLog = new OperationLogService(prisma);
  const rc = new RateCardsService(prisma, opLog);
  const svc = new BillsService(prisma, rc, opLog);
  const results: Array<[string, string, string, boolean]> = []; // name, expected, actual, ok
  const cmp = (name: string, expected: unknown, actual: unknown) =>
    results.push([name, String(expected), String(actual), String(expected) === String(actual)]);

  // Independent read of the seeded rates — the oracle for every hand derivation.
  // HALF-OPEN window: effectiveTo is the first instant the row no longer applies,
  // so it must be STRICTLY after the resolution instant (bills.service.ts uses
  // `gt`). An inclusive `>=` here is what let the NS boundary bug survive the
  // first audit pass: the oracle shared the engine's blind spot.
  const rates = await prisma.taxRate.findMany({ where: { isActive: true } });
  const rate = (cc: string, j: string, t: string, at: Date) => {
    const r = rates.find((x) => x.countryCode === cc && x.jurisdiction === j && x.taxType === t
      && x.effectiveFrom <= at && (!x.effectiveTo || x.effectiveTo > at));
    return r ? Number(r.ratePercent) : null;
  };

  const past = new Date(Date.UTC(2024, 0, 1)).toISOString();
  const handling = await rc.create({ name: `${TAG} h`, type: 'FULFILLMENT', effectiveAt: past,
    items: [{ itemCode: 'OUTBOUND_HANDLING', tierBasis: 'WEIGHT_KG', rangeStart: 0, chargeUnit: 'PER_ORDER', unitPrice: 4 }] });
  await rc.activate(handling.id); await rc.assign({ customerId: cust.id, rateCardId: handling.id, priority: 10 });
  const freight = await rc.create({ name: `${TAG} f`, type: 'SHIPPING', carrier: 'ADV-CARRIER', effectiveAt: past,
    items: [{ zone: 'Z', tierBasis: 'WEIGHT_KG', rangeStart: 0, chargeUnit: 'PER_ORDER', unitPrice: 10 }],
    zones: [{ destination: 'V6B', zone: 'Z' }] });
  await rc.activate(freight.id); await rc.assign({ customerId: cust.id, rateCardId: freight.id, priority: 10 });

  const BASE = 14; // freight 10 + handling 4, per order
  const mk = (no: string, shippedAt: Date, over: any = {}) => prisma.outboundOrder.create({ data: {
    orderNo: `${TAG}-${no}`, customerId: cust.id, warehouseId: wh.id, status: 'SHIPPED', shippedAt,
    packageActualWeight: 2, recipientZip: 'V6B 1A1', carrier: 'ADV-CARRIER', recipientCountry: 'CA', recipientProvince: 'BC', ...over } });
  const line = (b: any, t: string) => Number(b.items.find((i: any) => i.feeType === t)?.totalAmount ?? NaN);
  const periodEnd = (y: number, m: number) => new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1, 0, 0, 0, -1));

  // ─── Case 1: BC → GST 5 + PST 7 as TWO lines ─────────────────────────
  await mk('BC1', new Date(Date.UTC(2026, 6, 10)));
  const bc: any = await svc.generateMonthlyBill(cust.id, '2026-07');
  const at07 = periodEnd(2026, 7);
  cmp('BC GST_BC = base × GST%', r2(BASE * rate('CA', 'BC', 'GST', at07)! / 100), line(bc, 'GST_BC'));
  cmp('BC PST_BC = base × PST%', r2(BASE * rate('CA', 'BC', 'PST', at07)! / 100), line(bc, 'PST_BC'));
  cmp('BC: exactly 2 TAX lines', 2, bc.items.filter((i: any) => i.kind === 'TAX').length);
  cmp('BC: PST is NOT compounded on GST (tax on base only)', r2(BASE * 0.07), line(bc, 'PST_BC'));

  // ─── Case 2: NS rate boundary — March 2025 (15%) vs May 2025 (14%) ───
  await mk('NS-MAR', new Date(Date.UTC(2025, 2, 10)), { recipientProvince: 'NS' });
  await mk('NS-MAY', new Date(Date.UTC(2025, 4, 10)), { recipientProvince: 'Nova Scotia' });
  const nsMar: any = await svc.generateMonthlyBill(cust.id, '2025-03');
  const nsMay: any = await svc.generateMonthlyBill(cust.id, '2025-05');
  cmp('NS March 2025 resolves the 15% row', 15, rate('CA', 'NS', 'HST', periodEnd(2025, 3)));
  cmp('NS March 2025 HST_NS = base × 15%', r2(BASE * 0.15), line(nsMar, 'HST_NS'));
  cmp('NS May 2025 resolves the 14% row', 14, rate('CA', 'NS', 'HST', periodEnd(2025, 5)));
  cmp('NS May 2025 HST_NS = base × 14% ("Nova Scotia" spelled out)', r2(BASE * 0.14), line(nsMay, 'HST_NS'));

  // ─── Case 3: mixed month ON + BC + AU + NZ ───────────────────────────
  await mk('MX-ON', new Date(Date.UTC(2026, 7, 5)), { recipientProvince: 'ON' });
  await mk('MX-BC', new Date(Date.UTC(2026, 7, 6)));
  await mk('MX-AU', new Date(Date.UTC(2026, 7, 7)), { recipientCountry: 'AU', recipientProvince: 'VIC' });
  await mk('MX-NZ', new Date(Date.UTC(2026, 7, 8)), { recipientCountry: 'NZ', recipientProvince: 'BOP' });
  const mx: any = await svc.generateMonthlyBill(cust.id, '2026-08');
  const expMxTax = r2(r2(BASE * 0.13) + r2(BASE * 0.05) + r2(BASE * 0.07));
  cmp('mixed: HST_ON', r2(BASE * 0.13), line(mx, 'HST_ON'));
  cmp('mixed: GST_BC + PST_BC', r2(r2(BASE * 0.05) + r2(BASE * 0.07)), r2(line(mx, 'GST_BC') + line(mx, 'PST_BC')));
  cmp('mixed: EXPORT_AU explicit 0.00', 0, line(mx, 'EXPORT_AU'));
  cmp('mixed: EXPORT_NZ explicit 0.00 (NZ handled like AU, not special-cased)', 0, line(mx, 'EXPORT_NZ'));
  cmp('mixed: total = 4 × base + CA tax only', r2(4 * BASE + expMxTax), Number(mx.amount));
  cmp('mixed: provisional (export review + fuel pending)', true, mx.isProvisional);

  // ─── Case 4: per-event rounding (the engine rounds each event, then sums) ─
  // 3 orders of base 14 at 13%: per-event 1.82 ×3 = 5.46 ; whole-month 42×0.13 = 5.46 (same).
  // Choose a base where they differ: use 3 orders in QC at QST 9.975%:
  //   per-event: r2(14×0.09975)=r2(1.3965)=1.40 ×3 = 4.20 ; whole-month: r2(42×0.09975)=r2(4.1895)=4.19
  await mk('RD1', new Date(Date.UTC(2026, 8, 1)), { recipientProvince: 'QC' });
  await mk('RD2', new Date(Date.UTC(2026, 8, 2)), { recipientProvince: 'QC' });
  await mk('RD3', new Date(Date.UTC(2026, 8, 3)), { recipientProvince: 'QC' });
  const rd: any = await svc.generateMonthlyBill(cust.id, '2026-09');
  const perEvent = r2(3 * r2(BASE * 0.09975));
  const wholeMonth = r2(3 * BASE * 0.09975);
  cmp(`rounding: per-event (${perEvent}) differs from whole-month (${wholeMonth}) for this case`, true, perEvent !== wholeMonth);
  cmp('rounding: engine uses PER-EVENT rounding (matches charge-calculator contract)', perEvent, line(rd, 'QST_QC'));

  // ─── Case 5: pending FUEL never leaks into the taxable base ──────────
  // In case 3 the FUEL line is pending; tax must equal tax-on-base-only.
  cmp('fuel: pending FUEL line amount is 0', 0, line(mx, 'FUEL'));
  cmp('fuel: tax computed on base ONLY while fuel pending (no leak)', expMxTax,
    r2(mx.items.filter((i: any) => i.kind === 'TAX').reduce((s: number, i: any) => s + Number(i.totalAmount), 0)));

  // ─── Case 6: forced double-finalize — ledger must not double-post ────
  const balBefore = Number((await prisma.customer.findUniqueOrThrow({ where: { id: cust.id } })).balance);
  const fin: any = await svc.finalize(mx.id, [{ code: 'FUEL', amount: 5 }], ['EXPORT_ZERO_RATED']);
  const balAfter1 = Number((await prisma.customer.findUniqueOrThrow({ where: { id: cust.id } })).balance);
  // expected delta: +4×5 fuel = 20, plus tax on fuel for CA orders: ON 5×13%=0.65, BC 5×(5+7)%=0.60 → 21.25
  const expDelta = r2(20 + r2(5 * 0.13) + r2(5 * 0.05) + r2(5 * 0.07));
  cmp('finalize: delta = fuel + tax-on-fuel for CA orders only', expDelta, fin.delta);
  cmp('finalize: balance moved by exactly delta', r2(balBefore - expDelta), balAfter1);
  let second = 'no-error';
  try { await svc.finalize(mx.id, [{ code: 'FUEL', amount: 5 }], ['EXPORT_ZERO_RATED']); } catch (e: any) { second = e?.status === 400 ? '400' : `other:${e?.message}`; }
  const balAfter2 = Number((await prisma.customer.findUniqueOrThrow({ where: { id: cust.id } })).balance);
  cmp('double-finalize: second call refused with 400', '400', second);
  cmp('double-finalize: balance unchanged by the refused call', balAfter1, balAfter2);
  const finRows = await prisma.customerTransaction.count({ where: { customerId: cust.id, description: { contains: 'finalize' } } });
  cmp('double-finalize: exactly ONE finalize ledger row', 1, finRows);

  // ─── Case 7: 面议 (quote-on-request) freight → no tax, no review flag ──
  // An order to a postcode with no zone mapping → freight unpriced; handling still priced → taxed on handling only.
  await mk('UNP', new Date(Date.UTC(2026, 9, 5)), { recipientZip: 'ZZZ 9Z9', recipientProvince: 'AB' });
  const unp: any = await svc.generateMonthlyBill(cust.id, '2026-10');
  cmp('unpriced freight: GST_AB taxes HANDLING only (4 × 5%)', r2(4 * 0.05), line(unp, 'GST_AB'));
  cmp('unpriced freight: an UNPRICED line names the freight reason', true, unp.items.some((i: any) => i.kind === 'UNPRICED' && /运费|分区|邮编/.test(i.description)));
  cmp('unpriced freight: no tax-review flag raised (province resolved fine)', false, (unp.warnings as string[]).some((w) => w.includes('无法识别')));

  // ─── Ledger invariant across everything ──────────────────────────────
  const sum = r2((await prisma.customerTransaction.findMany({ where: { customerId: cust.id } })).reduce((s, t) => s + Number(t.amount), 0));
  const bal = Number((await prisma.customer.findUniqueOrThrow({ where: { id: cust.id } })).balance);
  cmp('ledger: Σ CustomerTransaction == Customer.balance after 7 bills + finalize', sum, bal);

  // ─── Report ──────────────────────────────────────────────────────────
  let fails = 0;
  for (const [name, exp, act, ok] of results) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      expected=${exp}  actual=${act}`);
    if (!ok) fails++;
  }
  await wipe(prisma, cust.id);
  const residue = await prisma.customerBill.count({ where: { customerId: cust.id } }) + await prisma.outboundOrder.count({ where: { customerId: cust.id } });
  console.log(`cleanup residue rows: ${residue}`);
  await prisma.$disconnect();
  console.log(`\nVERDICT: ${fails === 0 ? 'SURVIVED' : 'REFUTED'} — ${results.length - fails}/${results.length} hand-derived expectations matched`);
  process.exit(fails === 0 && residue === 0 ? 0 : 1);
}
main().catch(async (e) => { console.error('AUDIT ERROR:', e?.message ?? e); process.exit(1); });
