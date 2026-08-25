import {
  assembleCharges, SurchargeDef, TaxRateDef,
} from '../src/billing-charges/charge-calculator';

// Verification for the charge assembly layer (report v4.37).
//
// Runs with NO DATABASE — the calculator is pure by design, so its behaviour can
// be pinned down independently of Prisma, Nest, or a reachable Supabase.
//
// ⚠ Every figure here is synthetic. Real rates never enter the repo.

const checks: Array<[string, boolean]> = [];
const push = (n: string, ok: boolean) => checks.push([n, ok]);

const TAX_NS: TaxRateDef[] = [{ jurisdiction: 'Nova Scotia', taxType: 'HST', ratePercent: 15 }];
const TAX_AB: TaxRateDef[] = [{ jurisdiction: 'Alberta', taxType: 'GST', ratePercent: 5 }];

const flat: SurchargeDef = { code: 'PEAK', name: '旺季附加费', calcType: 'FLAT', value: 9 };
const pct: SurchargeDef = { code: 'RTS', name: '原件退回', calcType: 'PERCENT_OF_BASE', value: 150 };
const fuel: SurchargeDef = { code: 'FUEL', name: '燃油附加费', calcType: 'PASS_THROUGH' };

// ─── Base only ────────────────────────────────────────────────────────
const a = assembleCharges({ base: 100, surcharges: [], taxes: TAX_NS });
push('base only: tax applies to the base (100 → +15 HST)', a.tax === 15 && a.total === 115);
push('base only: nothing pending, so the result is final', !a.isProvisional && a.pending.length === 0);

// ─── Tax rate follows the destination ─────────────────────────────────
const b = assembleCharges({ base: 100, surcharges: [], taxes: TAX_AB });
push('tax: the rate is per-province, not a constant (Alberta 5% → 105)', b.total === 105);
push('tax: the line names the type and jurisdiction for filing',
  b.lines.some((l) => l.kind === 'TAX' && l.name.includes('GST') && l.name.includes('Alberta')));

// ─── FLAT and PERCENT surcharges are taxed WITH the base ──────────────
const c = assembleCharges({ base: 100, surcharges: [flat], taxes: TAX_NS });
push('flat surcharge: added before tax (100 + 9 = 109 → +16.35)',
  c.surcharges === 9 && c.taxableSubtotal === 109 && c.tax === 16.35 && c.total === 125.35);

const d = assembleCharges({ base: 100, surcharges: [pct], taxes: TAX_NS });
push('percent surcharge: computed off the BASE, not the running total (150% → 150)',
  d.surcharges === 150 && d.taxableSubtotal === 250);

// Ordering matters: a percent surcharge must not compound onto a flat one.
const e = assembleCharges({ base: 100, surcharges: [flat, pct], taxes: TAX_NS });
push('ordering: percent is off base only — 9 + 150, never 150% of 109',
  e.surcharges === 159 && e.taxableSubtotal === 259);

// ─── Tax is never levied on tax ───────────────────────────────────────
const f = assembleCharges({
  base: 100, surcharges: [],
  taxes: [
    { jurisdiction: 'Quebec', taxType: 'GST', ratePercent: 5 },
    { jurisdiction: 'Quebec', taxType: 'QST', ratePercent: 9.975 },
  ],
});
push('compound tax: both rates apply to the same subtotal, not to each other',
  f.tax === 14.98 && f.lines.filter((l) => l.kind === 'TAX').length === 2);

// ─── Pass-through: the whole reason this layer exists ─────────────────
const g = assembleCharges({ base: 100, surcharges: [fuel], taxes: TAX_NS });
push('pass-through: an uninvoiced fuel line is NULL, never 0',
  g.lines.find((l) => l.code === 'FUEL')?.amount === null);
push('pass-through: it does not silently enter the total',
  g.surcharges === 0 && g.total === 115);
push('pass-through: the result is flagged provisional',
  g.isProvisional && g.pending.includes('FUEL'));
push('pass-through: and says why in a warning',
  g.warnings.some((w) => w.includes('实报实销')));

const h = assembleCharges({
  base: 100, surcharges: [fuel], taxes: TAX_NS, actuals: [{ code: 'FUEL', amount: 12.34 }],
});
push('pass-through: once the carrier invoice arrives it prices normally',
  h.surcharges === 12.34 && h.taxableSubtotal === 112.34 && !h.isProvisional);
push('pass-through: and is then taxed with everything else',
  h.tax === 16.85 && h.total === 129.19);

// ─── A missing tax table must be loud ─────────────────────────────────
const i = assembleCharges({ base: 100, surcharges: [], taxes: [] });
push('no tax table: charges nothing but warns rather than pretending 0% is right',
  i.tax === 0 && i.warnings.some((w) => w.includes('未匹配到目的地税率')));

// ─── Non-taxable surcharges are excluded from the taxable base ────────
const j = assembleCharges({
  base: 100,
  surcharges: [{ code: 'ADMIN', name: '代理费', calcType: 'FLAT', value: 20, taxable: false }],
  taxes: TAX_NS,
});
push('non-taxable surcharge: counted in the total, excluded from the taxable base',
  j.surcharges === 20 && j.taxableSubtotal === 100 && j.total === 115);

console.log('=== sample ===');
console.log(JSON.stringify(
  assembleCharges({ base: 100, surcharges: [flat, pct, fuel], taxes: TAX_NS }), null, 2,
));
console.log('');

let allOk = true;
for (const [name, ok] of checks) {
  console.log(`CROSS-CHECK ${name} -> ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) allOk = false;
}
console.log(`\n${allOk ? 'ALL CHECKS PASSED' : 'SOME CHECKS FAILED'} (${checks.length} checks)`);
process.exit(allOk ? 0 : 1);
