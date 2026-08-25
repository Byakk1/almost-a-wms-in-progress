/**
 * Charge assembly: base freight → surcharges → taxes → invoice total.
 *
 * Deliberately PURE. No Prisma, no Nest, no I/O — every input is passed in. The
 * rate card engine already owns "what does one line cost"; this owns "how do the
 * lines stack into an invoice", which is a different question and the one that
 * actually decides the number a customer sees.
 *
 * ── Why surcharges could not just be more RateCardItems ───────────────
 *
 * The workbook's surcharges have three incompatible shapes, and only the first
 * fits the tier model:
 *
 *   FLAT             a fixed amount per parcel — peak surcharge, oversize
 *   PERCENT_OF_BASE  a multiplier on base freight — 原件退回 at 1.5× outbound
 *   PASS_THROUGH     whatever the carrier actually invoiced — 燃油附加费
 *
 * PASS_THROUGH is the important one. The rules sheet marks fuel 实报实销: the
 * amount is not knowable from any price list, it arrives on the carrier's bill
 * weeks later. A rate card literally cannot hold it. Modelling it as a percentage
 * — which is what the old mock frontend did with a hardcoded 12% — produces a
 * number that looks authoritative and is wrong every month.
 *
 * ── Why tax is separate from surcharges ──────────────────────────────
 *
 * GST/HST is a PERCENTAGE OF (freight + surcharges), not another line item, and
 * its rate depends on the destination province — 5% in Alberta, 15% in Nova
 * Scotia. So it must be applied after surcharges, over their sum, at a rate keyed
 * by jurisdiction. Putting it in the same list as surcharges would either tax the
 * tax or miss the surcharges, depending on ordering.
 */

export type SurchargeCalcType = 'FLAT' | 'PERCENT_OF_BASE' | 'PASS_THROUGH';

export interface SurchargeDef {
  code: string;
  name: string;
  calcType: SurchargeCalcType;
  /** FLAT: an amount. PERCENT_OF_BASE: a percentage, so 15 means 15%. */
  value?: number | null;
  /** Whether this surcharge is inside the taxable base. Almost always true. */
  taxable?: boolean;
  /** Free text from the price list — the condition a human must still judge. */
  note?: string | null;
}

export interface TaxRateDef {
  /** Province / territory as the carrier's tax table names it. */
  jurisdiction: string;
  /** GST | HST | PST | QST — reported separately because filings need the split. */
  taxType: string;
  /** Percentage, so 15 means 15%. */
  ratePercent: number;
}

/** An amount the carrier actually invoiced, for a PASS_THROUGH surcharge. */
export interface ActualCost {
  code: string;
  amount: number;
}

export interface ChargeLine {
  code: string;
  name: string;
  kind: 'BASE' | 'SURCHARGE' | 'TAX';
  calcType?: SurchargeCalcType;
  /** null when the amount is not yet knowable — see `pending`. */
  amount: number | null;
  taxable: boolean;
  pending: boolean;
  note?: string | null;
}

export interface ChargeBreakdown {
  lines: ChargeLine[];
  base: number;
  surcharges: number;
  taxableSubtotal: number;
  tax: number;
  /** Everything currently knowable. NOT final while `pending` is non-empty. */
  total: number;
  /** Codes whose amount is still awaiting a carrier invoice. */
  pending: string[];
  /** True while any pass-through amount is missing, so callers cannot mistake
   *  a partial figure for a final invoice. */
  isProvisional: boolean;
  warnings: string[];
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Assemble one shipment's charges.
 *
 * `actuals` carries carrier-invoiced amounts for PASS_THROUGH codes. A
 * PASS_THROUGH with no actual yet stays `pending` with a null amount rather than
 * defaulting to 0 — a fuel line silently worth zero is the exact failure this
 * whole structure exists to prevent.
 */
export function assembleCharges(input: {
  base: number;
  surcharges: SurchargeDef[];
  taxes: TaxRateDef[];
  actuals?: ActualCost[];
}): ChargeBreakdown {
  const { base, surcharges, taxes } = input;
  const actuals = new Map((input.actuals ?? []).map((a) => [a.code, a.amount]));
  const warnings: string[] = [];
  const pending: string[] = [];

  const lines: ChargeLine[] = [{
    code: 'BASE_FREIGHT', name: '基础运费', kind: 'BASE',
    amount: round2(base), taxable: true, pending: false,
  }];

  for (const s of surcharges) {
    const taxable = s.taxable !== false;
    let amount: number | null = null;
    let isPending = false;

    switch (s.calcType) {
      case 'FLAT':
        amount = Number(s.value ?? 0);
        break;
      case 'PERCENT_OF_BASE':
        amount = round2((base * Number(s.value ?? 0)) / 100);
        break;
      case 'PASS_THROUGH':
        if (actuals.has(s.code)) {
          amount = round2(actuals.get(s.code)!);
        } else {
          isPending = true;
          pending.push(s.code);
          warnings.push(`${s.name}（${s.code}）为实报实销，尚未收到承运商账单，未计入合计`);
        }
        break;
    }

    lines.push({
      code: s.code, name: s.name, kind: 'SURCHARGE', calcType: s.calcType,
      amount, taxable, pending: isPending, note: s.note ?? null,
    });
  }

  const surchargeTotal = round2(
    lines.filter((l) => l.kind === 'SURCHARGE' && l.amount !== null)
      .reduce((s, l) => s + l.amount!, 0),
  );

  // Tax applies to base + taxable surcharges. A pending pass-through is NOT in
  // here, so the tax will need recomputing once its actual arrives — which is why
  // the result is flagged provisional rather than quietly under-taxed.
  const taxableSubtotal = round2(
    lines.filter((l) => l.taxable && l.amount !== null && l.kind !== 'TAX')
      .reduce((s, l) => s + l.amount!, 0),
  );

  let taxTotal = 0;
  for (const t of taxes) {
    const amount = round2((taxableSubtotal * t.ratePercent) / 100);
    taxTotal = round2(taxTotal + amount);
    lines.push({
      code: `${t.taxType}_${t.jurisdiction}`,
      name: `${t.taxType} ${t.ratePercent}%（${t.jurisdiction}）`,
      kind: 'TAX', amount, taxable: false, pending: false,
    });
  }

  if (!taxes.length) {
    warnings.push('未匹配到目的地税率，账单未计税——加拿大各省 GST/HST 不同，需补税率表');
  }

  return {
    lines,
    base: round2(base),
    surcharges: surchargeTotal,
    taxableSubtotal,
    tax: taxTotal,
    total: round2(taxableSubtotal + taxTotal),
    pending,
    isProvisional: pending.length > 0,
    warnings,
  };
}
