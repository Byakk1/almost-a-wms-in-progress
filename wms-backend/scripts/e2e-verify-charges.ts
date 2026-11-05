import {
  assembleCharges, SurchargeDef, TaxRateDef,
} from '../src/billing-charges/charge-calculator';
import {
  normalizeDestination, parseWarehouseAddress,
} from '../src/common/destination';

// Verification for the charge assembly layer (report v4.37) and, since E4, the
// destination normaliser that feeds it.
//
// Runs with NO DATABASE — both modules are pure by design, so their behaviour can
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

// ─── E4: handling joins the taxable base (ancillary rule, decision 3) ─
const handling = { code: 'OUTBOUND_HANDLING', name: '出库操作费', amount: 7 };
const k = assembleCharges({ base: 11, additionalTaxableBase: [handling], surcharges: [], taxes: [
  { jurisdiction: 'ON', taxType: 'HST', ratePercent: 13 },
] });
push('handling: emitted as its own BASE line, not folded into freight',
  k.lines.filter((l) => l.kind === 'BASE').length === 2
  && k.lines.some((l) => l.code === 'OUTBOUND_HANDLING' && l.kind === 'BASE' && l.amount === 7 && l.taxable));
push('handling: `base` still reports freight only (11), so callers see the same figure as before',
  k.base === 11);
push('handling: taxed with freight at the destination rate (11 + 7 = 18 → HST 2.34)',
  k.taxableSubtotal === 18 && k.tax === 2.34 && k.total === 20.34);

// PERCENT_OF_BASE must stay a percentage of FREIGHT: the price list defines it
// that way, and handling is not freight.
const l = assembleCharges({ base: 100, additionalTaxableBase: [handling], surcharges: [pct], taxes: TAX_NS });
push('handling: a percent surcharge is still off freight (150% of 100), never off freight + handling',
  l.surcharges === 150 && l.taxableSubtotal === 257);

// Omitting the field is byte-identical to the pre-E4 behaviour.
const m0 = assembleCharges({ base: 100, surcharges: [flat, pct, fuel], taxes: TAX_NS });
const m1 = assembleCharges({ base: 100, surcharges: [flat, pct, fuel], taxes: TAX_NS, additionalTaxableBase: [] });
push('handling: absent or empty input leaves every existing result unchanged',
  JSON.stringify(m0) === JSON.stringify(m1));

// Zero-rated export: the TAX line is still emitted, at 0 — never omitted.
const n = assembleCharges({ base: 11, additionalTaxableBase: [handling], surcharges: [], taxes: [
  { jurisdiction: 'AU', taxType: 'EXPORT', ratePercent: 0 },
] });
push('export: a 0% rate still produces an explicit TAX line (EXPORT_AU 0.00)',
  n.lines.some((t) => t.kind === 'TAX' && t.code === 'EXPORT_AU' && t.amount === 0) && n.tax === 0 && n.total === 18);

// ─── E4: destination normaliser — every distinct value in the live DB ─
// (country, province) → expected (countryCode, jurisdiction). The list is the
// exact distinct set probed on 2026-11-02 plus the spellings the PRD names.
const DEST_TABLE: Array<[string | null, string | null, string | null, string | null]> = [
  // CA: codes and full names must both resolve to the code
  ['CA', 'AB', 'CA', 'AB'], ['CA', 'Alberta', 'CA', 'AB'],
  ['CA', 'BC', 'CA', 'BC'], ['CA', 'British Columbia', 'CA', 'BC'],
  ['CA', 'MB', 'CA', 'MB'], ['CA', 'Manitoba', 'CA', 'MB'],
  ['CA', 'NB', 'CA', 'NB'], ['CA', 'New Brunswick', 'CA', 'NB'],
  ['CA', 'NL', 'CA', 'NL'], ['CA', 'Newfoundland and Labrador', 'CA', 'NL'],
  ['CA', 'NS', 'CA', 'NS'], ['CA', 'Nova Scotia', 'CA', 'NS'],
  ['CA', 'ON', 'CA', 'ON'], ['CA', 'Ontario', 'CA', 'ON'],
  ['CA', 'QC', 'CA', 'QC'], ['CA', 'Quebec', 'CA', 'QC'], ['CA', 'Québec', 'CA', 'QC'],
  ['CA', 'SK', 'CA', 'SK'], ['CA', 'Saskatchewan', 'CA', 'SK'],
  ['CA', 'PE', 'CA', 'PE'], ['CA', 'PEI', 'CA', 'PE'], ['CA', 'Prince Edward Island', 'CA', 'PE'],
  ['CA', 'NT', 'CA', 'NT'], ['CA', 'Northwest Territories', 'CA', 'NT'],
  ['CA', 'NU', 'CA', 'NU'], ['CA', 'Nunavut', 'CA', 'NU'],
  ['CA', 'YT', 'CA', 'YT'], ['CA', 'Yukon', 'CA', 'YT'],
  // case / whitespace insensitive
  ['ca', ' ontario ', 'CA', 'ON'], ['Canada', 'british  columbia', 'CA', 'BC'],
  // AU: jurisdiction is the country (EXPORT row key), whatever the state
  ['AU', 'New South Wales', 'AU', 'AU'], ['AU', 'NSW', 'AU', 'AU'],
  ['AU', 'QLD', 'AU', 'AU'], ['AU', 'Queensland', 'AU', 'AU'],
  ['AU', 'SA', 'AU', 'AU'], ['AU', 'TAS', 'AU', 'AU'],
  ['AU', 'VIC', 'AU', 'AU'], ['AU', 'Victoria', 'AU', 'AU'],
  ['AU', 'WA', 'AU', 'AU'], ['AU', 'Western Australia', 'AU', 'AU'],
  // NZ / US likewise
  ['NZ', 'BOP', 'NZ', 'NZ'], ['NZ', 'NTL', 'NZ', 'NZ'], ['NZ', 'STL', 'NZ', 'NZ'],
  ['US', 'CA', 'US', 'US'], // US state "CA" is California, NOT Canada
  // unresolvable → nulls, never a guess
  [null, null, null, null],
  ['CA', null, null, null],
  ['CA', 'Narnia', null, null],
  ['CA', '', null, null],
  ['XX', 'ON', null, null],
  [null, 'ON', null, null],
];
let destOk = true;
const destFails: string[] = [];
for (const [country, region, cc, jur] of DEST_TABLE) {
  const d = normalizeDestination(country, region);
  if (d.countryCode !== cc || d.jurisdiction !== jur) {
    destOk = false;
    destFails.push(`(${country}, ${region}) → ${JSON.stringify(d)} expected (${cc}, ${jur})`);
  }
}
push(`normalizeDestination: all ${DEST_TABLE.length} live + PRD-named values resolve as expected`, destOk);
if (destFails.length) console.log('  normalizeDestination mismatches:\n   ' + destFails.join('\n   '));

// Warehouse addresses: the structured `CC/REGION/City//...` shape and the
// free-text shapes the fixtures use.
const WH_TABLE: Array<[string | null, string | null, string | null]> = [
  ['CA/BC/Richmond//Dock3 11420 Blacksmith Place///V7A 4X1', 'CA', 'BC'],
  ['CA/ON/Mississauga//3495 Laird Road, Units 16 and 17///L5L 5S5', 'CA', 'ON'],
  ['CA/ON/Test//1 Test Rd///M1M1M1', 'CA', 'ON'],
  ['AU/NSW/Villawood//C/O 2B/246 Miller Road///2163', 'AU', 'AU'],
  ['AU/VIC/Rowville//9 Mosrael Place///3178', 'AU', 'AU'],
  ['NZ/Auckland/Mangere//54 Ascot Rd///2022', 'NZ', 'NZ'],
  ['localhost', null, null],
  ['测试仓地址123', null, null],
  ['CA/Narnia/Nowhere', null, null],
  ['', null, null],
  [null, null, null],
];
let whOk = true;
const whFails: string[] = [];
for (const [addr, cc, jur] of WH_TABLE) {
  const d = parseWarehouseAddress(addr);
  if (d.countryCode !== cc || d.jurisdiction !== jur) {
    whOk = false;
    whFails.push(`${JSON.stringify(addr)} → ${JSON.stringify(d)} expected (${cc}, ${jur})`);
  }
}
push(`parseWarehouseAddress: all ${WH_TABLE.length} live + fixture addresses resolve as expected`, whOk);
if (whFails.length) console.log('  parseWarehouseAddress mismatches:\n   ' + whFails.join('\n   '));

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
