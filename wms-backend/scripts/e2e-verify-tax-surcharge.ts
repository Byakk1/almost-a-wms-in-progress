import 'reflect-metadata';
import 'dotenv/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { OperationLogService } from '../src/common/operation-log.service';
import { TaxRatesService } from '../src/tax-rates/tax-rates.service';
import { SurchargesService } from '../src/surcharges/surcharges.service';

// E2E verification of the E4 tax-rate + surcharge config APIs
// (PRD docs/prd/2026-11-02-e4-billing-tax.md §5 / §7 / §10).
//
// Drives the REAL TaxRatesService + SurchargesService against the live DB — service
// level, no HTTP, no Nest DI — on fixtures with distinctive keys so nothing here can
// touch the 21 seeded tax rates or the seeded FUEL surcharge:
//
//   TaxRate    countryCode 'ZZ'   + jurisdiction 'E2E*'
//   Surcharge  code        'E2E_*'
//
//   TaxRates   · create → list filter → update ratePercent/note
//              · overlap refused · adjacent windows allowed · effectiveTo<=From refused
//              · duplicate unique key → 409 · update cannot change key fields
//   Surcharges · create FLAT → list → update name
//              · FLAT w/o value refused · PERCENT 1500 refused
//              · PASS_THROUGH with value refused · PASS_THROUGH w/o value ok
//              · duplicate code → 409 · update PASS_THROUGH row with value refused
//   Audit      · an OperationLog row per write, never a passwordHash
//   Seeds      · TaxRate total unchanged (21) · FUEL value still NULL
//
// Re-runnable: fixtures wiped before + after; the finally asserts 0 remain.

const TAX_CC = 'ZZ';
const TAX_JUR = 'E2E';
const SUR_PREFIX = 'E2E_';

const SEEDED_TAX_ROWS = 21;

const taxWhere = { countryCode: TAX_CC, jurisdiction: { startsWith: TAX_JUR } };
const surWhere = { code: { startsWith: SUR_PREFIX } };

async function wipeFixtures(prisma: PrismaService) {
  const [taxRows, surRows] = await Promise.all([
    prisma.taxRate.findMany({ where: taxWhere, select: { id: true } }),
    prisma.surcharge.findMany({ where: surWhere, select: { id: true } }),
  ]);
  const taxIds = taxRows.map((r) => r.id);
  const surIds = surRows.map((r) => r.id);
  if (taxIds.length) {
    await prisma.operationLog.deleteMany({ where: { entityType: 'TaxRate', entityId: { in: taxIds } } });
  }
  if (surIds.length) {
    await prisma.operationLog.deleteMany({ where: { entityType: 'Surcharge', entityId: { in: surIds } } });
  }
  await prisma.taxRate.deleteMany({ where: taxWhere });
  await prisma.surcharge.deleteMany({ where: surWhere });
}

/** Run a call expected to throw; return `{status, message}` or nulls if it did not. */
async function expectThrow(fn: () => Promise<unknown>): Promise<{ status: number | null; message: string }> {
  try {
    await fn();
    return { status: null, message: '' };
  } catch (e: any) {
    return { status: typeof e?.getStatus === 'function' ? e.getStatus() : (e?.status ?? null), message: e?.message ?? '' };
  }
}

async function main() {
  const prisma = new PrismaService();
  const audit = new OperationLogService(prisma);
  const taxRates = new TaxRatesService(prisma, audit);
  const surcharges = new SurchargesService(prisma, audit);

  const checks: [string, boolean][] = [];
  const push = (name: string, ok: boolean) => checks.push([name, ok]);

  await wipeFixtures(prisma);

  // Seed baseline — read BEFORE any fixture is written.
  const taxTotalBefore = await prisma.taxRate.count();
  const fuelBefore = await prisma.surcharge.findUnique({ where: { code: 'FUEL' }, select: { value: true } });
  push('seed baseline: TaxRate total is 21 before', taxTotalBefore === SEEDED_TAX_ROWS);
  push('seed baseline: FUEL exists with value NULL before', !!fuelBefore && fuelBefore.value === null);

  let allOk = false;
  try {
    // ═══════════════════ TaxRates ═══════════════════════════════════════

    // ── T1. create → list filter finds it ────────────────────────────
    const t1 = await taxRates.create({
      countryCode: TAX_CC, jurisdiction: `${TAX_JUR}A`, taxType: 'GST',
      ratePercent: 5, effectiveFrom: '2026-01-01', note: 'e2e fixture',
    });
    push('tax create: returns row with id', !!t1.id && t1.countryCode === TAX_CC && t1.jurisdiction === `${TAX_JUR}A`);
    push('tax create: effectiveTo defaults to null (open window)', t1.effectiveTo === null);
    push('tax create: isActive defaults true', t1.isActive === true);

    const listed = await taxRates.list({ countryCode: TAX_CC, jurisdiction: `${TAX_JUR}A` });
    push('tax list: countryCode+jurisdiction filter finds the fixture', listed.data.length === 1 && listed.data[0].id === t1.id);
    push('tax list: pagination envelope present', listed.pagination.page === 1 && listed.pagination.total === 1 && listed.pagination.pageSize === 20);

    const byType = await taxRates.list({ countryCode: TAX_CC, taxType: 'GST' });
    push('tax list: taxType filter is exact', byType.data.every((r) => r.taxType === 'GST') && byType.data.some((r) => r.id === t1.id));

    // ── T2. update ratePercent / note ────────────────────────────────
    const t1u = await taxRates.update(t1.id, { ratePercent: 7.5, note: 'e2e updated' });
    push('tax update: ratePercent changed', Number(t1u.ratePercent) === 7.5);
    push('tax update: note changed', t1u.note === 'e2e updated');
    push('tax update: identity untouched', t1u.countryCode === TAX_CC && t1u.jurisdiction === `${TAX_JUR}A` && t1u.taxType === 'GST');

    // ── T3. overlap refused (same key, intersecting window) ──────────
    const overlap = await expectThrow(() =>
      taxRates.create({
        countryCode: TAX_CC, jurisdiction: `${TAX_JUR}A`, taxType: 'GST',
        ratePercent: 6, effectiveFrom: '2026-06-01',
      }),
    );
    push('tax overlap: second row with intersecting window refused (400)', overlap.status === 400);
    push('tax overlap: message mentions 重叠', overlap.message.includes('重叠'));

    // ── T4. half-open windows: touching allowed, overlap refused ─────
    // effectiveTo is EXCLUSIVE — the first instant the row no longer applies.
    // End t1 at 2026-07-01 and start the successor the same day: zero gap, no
    // collision. This is the rotation the NS 15→14 % seed uses; the adversarial
    // audit proved a one-day gap leaves a whole month with no rate.
    const t1closed = await taxRates.update(t1.id, { effectiveTo: '2026-07-01' });
    push('tax window: end-date set', t1closed.effectiveTo?.toISOString().slice(0, 10) === '2026-07-01');
    const t2 = await taxRates.create({
      countryCode: TAX_CC, jurisdiction: `${TAX_JUR}A`, taxType: 'GST',
      ratePercent: 6, effectiveFrom: '2026-07-01',
    });
    push('tax adjacent: successor starting exactly when the predecessor ends is allowed (half-open)', !!t2.id);

    // Overlapping the predecessor by a single day is still refused:
    // [2026-06-30, 2026-07-01) pokes into t1 [2026-01-01, 2026-07-01).
    const pokesIn = await expectThrow(() =>
      taxRates.create({
        countryCode: TAX_CC, jurisdiction: `${TAX_JUR}A`, taxType: 'GST',
        ratePercent: 9, effectiveFrom: '2026-06-30', effectiveTo: '2026-07-01',
      }),
    );
    push('tax overlap: a window overlapping the predecessor by one day is refused', pokesIn.status === 400);

    // A row that starts INSIDE the now-closed window still collides.
    const insideClosed = await expectThrow(() =>
      taxRates.create({
        countryCode: TAX_CC, jurisdiction: `${TAX_JUR}A`, taxType: 'GST',
        ratePercent: 9, effectiveFrom: '2026-03-01', effectiveTo: '2026-04-01',
      }),
    );
    push('tax overlap: window inside a closed window still refused', insideClosed.status === 400);

    // ── T5. effectiveTo <= effectiveFrom refused ─────────────────────
    const badWindowCreate = await expectThrow(() =>
      taxRates.create({
        countryCode: TAX_CC, jurisdiction: `${TAX_JUR}B`, taxType: 'PST',
        ratePercent: 7, effectiveFrom: '2026-05-01', effectiveTo: '2026-05-01',
      }),
    );
    push('tax window: effectiveTo == effectiveFrom refused on create (400)', badWindowCreate.status === 400 && badWindowCreate.message.includes('晚于'));
    const badWindowUpdate = await expectThrow(() => taxRates.update(t2.id, { effectiveTo: '2026-06-01' }));
    push('tax window: effectiveTo < effectiveFrom refused on update (400)', badWindowUpdate.status === 400);

    // ── T6. duplicate unique key → 409 ───────────────────────────────
    // Same identity + same effectiveFrom as t2. The overlap guard runs first and only
    // looks at ACTIVE rows, so switch t2 off to let the request reach the DB index.
    await taxRates.update(t2.id, { isActive: false });
    const dup = await expectThrow(() =>
      taxRates.create({
        countryCode: TAX_CC, jurisdiction: `${TAX_JUR}A`, taxType: 'GST',
        ratePercent: 6, effectiveFrom: '2026-07-01',
      }),
    );
    push('tax duplicate: same key + effectiveFrom → 409', dup.status === 409);
    await taxRates.update(t2.id, { isActive: true });

    // ── T7. update cannot change key fields ──────────────────────────
    // UpdateTaxRateDto has no countryCode/jurisdiction/taxType; at service level the
    // extra keys are simply ignored (the HTTP pipe would strip or reject them).
    const t2k = await taxRates.update(t2.id, {
      note: 'key-change attempt', countryCode: 'QQ', jurisdiction: 'NOPE', taxType: 'HST',
    } as any);
    push('tax update: countryCode cannot be changed via update', t2k.countryCode === TAX_CC);
    push('tax update: jurisdiction/taxType cannot be changed via update', t2k.jurisdiction === `${TAX_JUR}A` && t2k.taxType === 'GST');
    push('tax update: non-key field still applied', t2k.note === 'key-change attempt');

    // ═══════════════════ Surcharges ═════════════════════════════════════

    // ── S1. create FLAT with value → list ────────────────────────────
    const s1 = await surcharges.create({
      code: `${SUR_PREFIX}RESI`, name: 'E2E 住宅派送', calcType: 'FLAT', value: 3.25,
      appliesTo: 'SHIPPING', effectiveFrom: '2026-01-01',
    });
    push('sur create FLAT: returns row with value', !!s1.id && Number(s1.value) === 3.25);
    push('sur create FLAT: taxable defaults true', s1.taxable === true);
    push('sur create FLAT: carrier defaults null', s1.carrier === null);
    push('sur create FLAT: appliesTo honoured', s1.appliesTo === 'SHIPPING');

    const sList = await surcharges.list({ code: `${SUR_PREFIX}RESI` });
    push('sur list: code filter finds the fixture', sList.data.length === 1 && sList.data[0].id === s1.id);
    push('sur list: pagination envelope present', sList.pagination.page === 1 && sList.pagination.total === 1);

    // ── S2. update name ──────────────────────────────────────────────
    const s1u = await surcharges.update(s1.id, { name: 'E2E 住宅派送（改）' });
    push('sur update: name changed', s1u.name === 'E2E 住宅派送（改）');
    push('sur update: code/calcType/value untouched', s1u.code === `${SUR_PREFIX}RESI` && s1u.calcType === 'FLAT' && Number(s1u.value) === 3.25);

    // ── S3. FLAT without value refused ───────────────────────────────
    const flatNoValue = await expectThrow(() =>
      surcharges.create({ code: `${SUR_PREFIX}FLAT_NOVAL`, name: 'x', calcType: 'FLAT', effectiveFrom: '2026-01-01' }),
    );
    push('sur FLAT without value refused (400)', flatNoValue.status === 400 && flatNoValue.message.includes('必须填写金额/比例'));

    // ── S4. PERCENT_OF_BASE 1500 refused ─────────────────────────────
    const pctTooHigh = await expectThrow(() =>
      surcharges.create({ code: `${SUR_PREFIX}PCT_HI`, name: 'x', calcType: 'PERCENT_OF_BASE', value: 1500, effectiveFrom: '2026-01-01' }),
    );
    push('sur PERCENT_OF_BASE 1500 refused (400)', pctTooHigh.status === 400 && pctTooHigh.message.includes('1000'));

    // Boundary: exactly 1000 is allowed, and PERCENT without value is refused.
    const pctEdge = await surcharges.create({
      code: `${SUR_PREFIX}PCT_EDGE`, name: 'E2E 比例边界', calcType: 'PERCENT_OF_BASE', value: 1000, effectiveFrom: '2026-01-01',
    });
    push('sur PERCENT_OF_BASE 1000 (boundary) allowed', Number(pctEdge.value) === 1000);
    const pctNoValue = await expectThrow(() =>
      surcharges.create({ code: `${SUR_PREFIX}PCT_NOVAL`, name: 'x', calcType: 'PERCENT_OF_BASE', effectiveFrom: '2026-01-01' }),
    );
    push('sur PERCENT_OF_BASE without value refused (400)', pctNoValue.status === 400);

    // ── S5. PASS_THROUGH with value refused ──────────────────────────
    const ptWithValue = await expectThrow(() =>
      surcharges.create({ code: `${SUR_PREFIX}PT_VAL`, name: 'x', calcType: 'PASS_THROUGH', value: 1, effectiveFrom: '2026-01-01' }),
    );
    push('sur PASS_THROUGH with value refused (400)', ptWithValue.status === 400 && ptWithValue.message.includes('实报实销不设固定值'));

    // ── S6. PASS_THROUGH without value ok ────────────────────────────
    const pt = await surcharges.create({
      code: `${SUR_PREFIX}PT`, name: 'E2E 实报实销', calcType: 'PASS_THROUGH', effectiveFrom: '2026-01-01',
    });
    push('sur PASS_THROUGH without value created with value NULL', !!pt.id && pt.value === null);

    // ── S7. duplicate code → 409 ─────────────────────────────────────
    const dupCode = await expectThrow(() =>
      surcharges.create({ code: `${SUR_PREFIX}RESI`, name: 'dup', calcType: 'FLAT', value: 1, effectiveFrom: '2026-01-01' }),
    );
    push('sur duplicate code → 409', dupCode.status === 409);

    // ── S8. update PASS_THROUGH row with a value refused ─────────────
    const ptUpdValue = await expectThrow(() => surcharges.update(pt.id, { value: 9 }));
    push('sur update PASS_THROUGH with value refused (400)', ptUpdValue.status === 400 && ptUpdValue.message.includes('实报实销'));
    const ptAfter = await prisma.surcharge.findUniqueOrThrow({ where: { id: pt.id }, select: { value: true } });
    push('sur update PASS_THROUGH: value still NULL after refusal', ptAfter.value === null);

    // Mirror: a FLAT row cannot have its value cleared.
    const flatClear = await expectThrow(() => surcharges.update(s1.id, { value: null }));
    push('sur update FLAT: clearing value refused (400)', flatClear.status === 400);

    // Window rule applies to surcharges too.
    const surBadWindow = await expectThrow(() => surcharges.update(s1.id, { effectiveTo: '2025-12-31' }));
    push('sur window: effectiveTo < effectiveFrom refused on update (400)', surBadWindow.status === 400);

    // ═══════════════════ Audit trail ════════════════════════════════════
    // Successful writes so far:
    //   TaxRate   CREATE t1, UPDATE t1 (rate), UPDATE t1 (end-date), CREATE t2,
    //             UPDATE t2 (off), UPDATE t2 (on), UPDATE t2 (key attempt)      = 7
    //   Surcharge CREATE s1, UPDATE s1 (name), CREATE pctEdge, CREATE pt         = 4
    const taxIds = [t1.id, t2.id];
    const surIds = [s1.id, pctEdge.id, pt.id];
    const taxLogs = await prisma.operationLog.findMany({
      where: { entityType: 'TaxRate', entityId: { in: taxIds } },
      select: { action: true, beforeData: true, afterData: true, description: true },
    });
    const surLogs = await prisma.operationLog.findMany({
      where: { entityType: 'Surcharge', entityId: { in: surIds } },
      select: { action: true, beforeData: true, afterData: true, description: true },
    });
    push(`audit: TaxRate has one row per write (expected 7, got ${taxLogs.length})`, taxLogs.length === 7);
    push(`audit: Surcharge has one row per write (expected 4, got ${surLogs.length})`, surLogs.length === 4);
    push('audit: TaxRate CREATE + UPDATE actions present', taxLogs.some((l) => l.action === 'CREATE') && taxLogs.some((l) => l.action === 'UPDATE'));
    push('audit: Surcharge CREATE + UPDATE actions present', surLogs.some((l) => l.action === 'CREATE') && surLogs.some((l) => l.action === 'UPDATE'));
    push('audit: UPDATE rows carry before AND after', [...taxLogs, ...surLogs].filter((l) => l.action === 'UPDATE').every((l) => !!l.beforeData && !!l.afterData));
    push('audit: CREATE rows carry after only', [...taxLogs, ...surLogs].filter((l) => l.action === 'CREATE').every((l) => !l.beforeData && !!l.afterData));
    const serialised = JSON.stringify([...taxLogs, ...surLogs]);
    push('audit: no passwordHash anywhere', !serialised.includes('passwordHash'));

    // Refused writes must NOT have produced audit rows: count equals successes exactly
    // (already asserted above), and no log references a code we never persisted.
    push('audit: refused writes left no trace', !serialised.includes(`${SUR_PREFIX}FLAT_NOVAL`) && !serialised.includes(`${SUR_PREFIX}PT_VAL`));

    // ═══════════════════ Seeds untouched ════════════════════════════════
    const fixturesNow = await prisma.taxRate.count({ where: taxWhere });
    const taxTotalNow = await prisma.taxRate.count();
    push('seed: TaxRate total == 21 + fixtures during run', taxTotalNow === SEEDED_TAX_ROWS + fixturesNow && fixturesNow === 2);
    const fuelNow = await prisma.surcharge.findUnique({ where: { code: 'FUEL' }, select: { value: true } });
    push('seed: FUEL value still NULL during run', !!fuelNow && fuelNow.value === null);

    allOk = true;
  } finally {
    await wipeFixtures(prisma);

    const [taxLeft, surLeft, taxLogLeft, surLogLeft, taxTotalAfter, fuelAfter] = await Promise.all([
      prisma.taxRate.count({ where: taxWhere }),
      prisma.surcharge.count({ where: surWhere }),
      prisma.operationLog.count({ where: { entityType: 'TaxRate', description: { contains: `${TAX_CC}/${TAX_JUR}` } } }),
      prisma.operationLog.count({ where: { entityType: 'Surcharge', description: { contains: SUR_PREFIX } } }),
      prisma.taxRate.count(),
      prisma.surcharge.findUnique({ where: { code: 'FUEL' }, select: { value: true } }),
    ]);
    push('cleanup: 0 ZZ/E2E* tax rows remain', taxLeft === 0);
    push('cleanup: 0 E2E_* surcharge rows remain', surLeft === 0);
    push('cleanup: 0 TaxRate OperationLog rows remain', taxLogLeft === 0);
    push('cleanup: 0 Surcharge OperationLog rows remain', surLogLeft === 0);
    push('seed: TaxRate total is 21 after', taxTotalAfter === SEEDED_TAX_ROWS);
    push('seed: FUEL value NULL after', !!fuelAfter && fuelAfter.value === null);

    // ── report ────────────────────────────────────────────────────────
    console.log('');
    let pass = 0;
    let fail = 0;
    for (const [name, ok] of checks) {
      console.log(`CROSS-CHECK ${name} -> ${ok ? 'PASS' : 'FAIL'}`);
      if (ok) pass++; else fail++;
    }
    await prisma.$disconnect();
    const good = allOk && fail === 0;
    console.log(`\n${good ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'} (${checks.length} checks: ${pass} pass, ${fail} fail)`);
    process.exit(good ? 0 : 1);
  }
}

main().catch(async (e) => {
  console.error('VERIFY ERROR:', e?.message ?? e);
  process.exit(1);
});
