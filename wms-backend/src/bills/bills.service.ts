import {
  BadRequestException, ConflictException, Injectable, NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RateCardsService } from '../rate-cards/rate-cards.service';
import { OperationLogService } from '../common/operation-log.service';
import { isUniqueViolation, nextDocNo } from '../common/doc-no';
import { normalizeDestination, parseWarehouseAddress } from '../common/destination';
import {
  assembleCharges, SurchargeDef, TaxRateDef, ActualCost, SurchargeCalcType,
} from '../billing-charges/charge-calculator';
import { ActualDto, ConfirmationCode, ListBillsQueryDto } from './dto/bill.dto';

/**
 * Monthly customer billing.
 *
 * Every figure here comes from a rate card applied to a real recorded event. The
 * previous implementation invented them — a `Math.random()` bill number and three
 * hardcoded amounts (500 / 150.5 / 850.75) presented as a finished invoice.
 *
 * ── What is billed ───────────────────────────────────────────────────
 *
 *   出库操作费  OUTBOUND_HANDLING  per order shipped in the period, by weight
 *   基础运费    SHIPPING           per order, by (postcode → zone, weight)
 *   入库操作费  INBOUND_HANDLING   per receipt completed in the period, by weight
 *   附加费      SURCHARGE          per active Surcharge row (FLAT / % / 实报实销)
 *   销售税      TAX                GST/HST/PST/QST by destination province (E4)
 *
 * ── Tax (E4, PRD §10) ────────────────────────────────────────────────
 *
 * Place of supply = the DESTINATION province for an outbound order, and the
 * WAREHOUSE's province for inbound handling. Rates come from `TaxRate` rows
 * resolved AS OF period end, same as rate cards. Handling follows the main
 * supply's rate (ancillary rule) — it rides in `additionalTaxableBase`.
 *
 * Non-CA destinations hit a 0 % EXPORT row and are FLAGGED for manual review;
 * an unresolvable province is untaxed and flagged. Both keep the bill
 * `isProvisional` until finalize() receives the matching confirmation code — a
 * bill never silently settles at 0 % because nobody looked.
 *
 * ── Provisional bills ────────────────────────────────────────────────
 *
 * `isProvisional` is true while any line is not final: a PASS_THROUGH surcharge
 * (fuel) with no carrier actual, or a review flag above. finalize() is the ONLY
 * path that clears it. mark-paid is allowed on a provisional bill (payment
 * against an escrow-style amount — decision 6); finalize then posts only the
 * delta, so the ledger always sums to the balance.
 *
 * ── What is deliberately NOT billed ──────────────────────────────────
 *
 * STORAGE. The card prices it per CBM·day (STORAGE_DROPSHIP, tierBasis
 * STORAGE_DAYS), which needs the volume held on each day of the period. Nothing
 * in the schema records that: Inventory holds only a CURRENT snapshot, and
 * multiplying today's stock by the days in the month would bill a customer who
 * cleared their inventory on the 2nd for a full month. Closing this needs a
 * daily snapshot table (E7). The bill says so, verbatim, in `warnings`.
 *
 * ── Unpriceable events are surfaced, never dropped ───────────────────
 *
 * An order with no postcode, a 面议 band, or no applicable card becomes a zero-
 * amount line naming the reason, and is counted in `warnings`. Silently omitting
 * it would under-bill by exactly the amount nobody noticed was missing.
 */

const BILLABLE_OUTBOUND = ['SHIPPED', 'SIGNED'];
const BILLABLE_RECEIVING = [
  'COMPLETED', 'PUTAWAY_PENDING', 'PUTAWAY_PARTIAL', 'PUTAWAY_COMPLETED',
];

// cm³ → volumetric kg. Same divisor as BoxesService.measure and FeeService, so a
// parcel is never quoted on one and billed on another.
const VOLUMETRIC_DIVISOR = 5000;

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export type LineKind = 'BASE' | 'SURCHARGE' | 'TAX' | 'UNPRICED';

type Line = {
  feeType: string;
  description: string;
  qty: number;
  unitPrice: number;
  totalAmount: number;
  kind: LineKind;
  isProvisional: boolean;
};

type Computed = {
  lines: Line[];
  total: number;
  warnings: string[];
  isProvisional: boolean;
  /** Codes still awaiting a carrier actual (PASS_THROUGH). */
  pendingCodes: string[];
  /** Confirmation codes still required to clear review flags. */
  pendingConfirmations: ConfirmationCode[];
  sourceEvents: { outboundOrders: number; receivingOrders: number };
};

const LABEL: Record<string, string> = {
  OUTBOUND_HANDLING: '出库操作费',
  SHIPPING: '基础运费',
  INBOUND_HANDLING: '入库操作费',
};

const STORAGE_WAIVER =
  '仓储费未计入：价卡按 CBM·天 计价，而系统没有逐日库存快照，' +
  '用当前库存乘以账期天数会对月初即清仓的客户超收。需补日快照表后另行结算。';

@Injectable()
export class BillsService {
  constructor(
    private prisma: PrismaService,
    private rateCards: RateCardsService,
    private opLog: OperationLogService,
  ) {}

  // ─── Generate ───────────────────────────────────────────────────────

  async generateMonthlyBill(
    customerId: string,
    period: string,
    actuals: ActualDto[] = [],
    confirmations: ConfirmationCode[] = [],
  ) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      throw new BadRequestException(`账期格式应为 YYYY-MM，收到 ${period}`);
    }

    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('客户不存在');

    const existing = await this.prisma.customerBill.findFirst({ where: { customerId, period } });
    if (existing) {
      throw new ConflictException(`客户 ${customer.name} 的 ${period} 账单已存在（${existing.billNo}）`);
    }

    const c = await this.compute(customerId, period, actuals, confirmations);
    const { to } = this.window(period);

    // The whole transaction is retried on a billNo collision: retrying inside it
    // would run against an already-aborted transaction.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const billNo = await this.nextBillNo(tx, period);

          const bill = await tx.customerBill.create({
            data: {
              billNo, customerId, period, amount: c.total, status: 'unpaid',
              dueDate: new Date(to.getTime() + 15 * 24 * 60 * 60 * 1000),
              isProvisional: c.isProvisional,
              warnings: c.warnings,
              taxRegistrationNo: process.env.BILLING_TAX_REG_NO ?? null,
              items: { create: c.lines },
            },
            include: { items: true },
          });

          // The balance is the point of a bill. Posting it here — in the same
          // transaction — is what makes the customer's account reflect what they
          // owe; previously a "generated" bill moved no money at all.
          const before = Number(customer.balance);
          const after = round2(before - c.total);
          if (c.total > 0) {
            await tx.customerTransaction.create({
              data: {
                customerId, type: 'deduction', amount: -c.total,
                description: `${period} 月度账单 ${billNo}`,
              },
            });
            await tx.customer.update({ where: { id: customerId }, data: { balance: after } });
          }

          await this.opLog.log({
            entityType: 'CustomerBill', entityId: bill.id, action: 'GENERATE',
            beforeData: { balance: before },
            afterData: { balance: c.total > 0 ? after : before, amount: c.total, billNo, isProvisional: c.isProvisional },
            description:
              `生成 ${period} 账单 ${billNo}，共 ${c.lines.length} 项，合计 ${c.total}` +
              `${c.isProvisional ? '（待确认）' : ''}` +
              `${c.warnings.length ? `，${c.warnings.length} 项提示` : ''}`,
          }, tx);

          return {
            ...bill,
            balanceBefore: before,
            balanceAfter: c.total > 0 ? after : before,
            sourceEvents: c.sourceEvents,
            warnings: c.warnings,
          };
        });
      } catch (e) {
        if (isUniqueViolation(e) && attempt < 4) continue;
        throw e;
      }
    }
    throw new BadRequestException('账单号生成冲突，请重试');
  }

  // ─── Finalize ───────────────────────────────────────────────────────

  /**
   * Clear a provisional bill by supplying what was missing at generation: the
   * carrier actuals for pass-through lines and/or the review confirmations.
   *
   * The month is RECOMPUTED through the same compute() as generate — not patched —
   * so tax is re-derived over the now-complete base. Items are replaced, and only
   * the DELTA is posted to the ledger: a bill the customer already paid is not
   * charged twice, and Σ CustomerTransaction stays equal to Customer.balance.
   */
  async finalize(id: string, actuals: ActualDto[] = [], confirmations: ConfirmationCode[] = []) {
    const bill = await this.getOrThrow(id);
    if (!bill.isProvisional) {
      throw new BadRequestException(`账单 ${bill.billNo} 不是待确认状态，无需 finalize`);
    }

    const c = await this.compute(bill.customerId, bill.period, actuals, confirmations);

    if (c.isProvisional) {
      const parts: string[] = [];
      if (c.pendingCodes.length) parts.push(`仍缺实报实销金额：${c.pendingCodes.join('、')}`);
      if (c.pendingConfirmations.length) parts.push(`仍需人工确认：${c.pendingConfirmations.join('、')}`);
      throw new BadRequestException(`无法完成 finalize —— ${parts.join('；')}`);
    }

    const oldAmount = Number(bill.amount);
    const delta = round2(c.total - oldAmount);
    const confirmedNote = confirmations.length
      ? `已于 finalize 人工确认：${confirmations.join('、')}`
      : '已于 finalize 补录实报实销金额';

    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id: bill.customerId } });
      if (!customer) throw new NotFoundException('客户不存在');
      const before = Number(customer.balance);
      const after = round2(before - delta);

      await tx.billItem.deleteMany({ where: { billId: id } });
      const updated = await tx.customerBill.update({
        where: { id },
        data: {
          amount: c.total,
          isProvisional: false,
          finalizedAt: new Date(),
          warnings: [...c.warnings, confirmedNote],
          items: { create: c.lines },
        },
        include: { items: true, customer: { select: { code: true, name: true } } },
      });

      if (delta !== 0) {
        await tx.customerTransaction.create({
          data: {
            customerId: bill.customerId, type: 'deduction', amount: -delta,
            description: `${bill.period} 账单 ${bill.billNo} finalize 调整`,
          },
        });
        await tx.customer.update({ where: { id: bill.customerId }, data: { balance: after } });
      }

      await this.opLog.log({
        entityType: 'CustomerBill', entityId: id, action: 'FINALIZE',
        beforeData: { amount: oldAmount, isProvisional: true, balance: before },
        afterData: { amount: c.total, isProvisional: false, balance: delta !== 0 ? after : before, delta },
        description: `finalize ${bill.period} 账单 ${bill.billNo}：${oldAmount} → ${c.total}（差额 ${delta}）；${confirmedNote}`,
      }, tx);

      return {
        ...updated,
        balanceBefore: before,
        balanceAfter: delta !== 0 ? after : before,
        delta,
        sourceEvents: c.sourceEvents,
        warnings: updated.warnings,
      };
    });
  }

  // ─── Mark paid ──────────────────────────────────────────────────────

  /**
   * Record receipt of payment. Allowed on a provisional bill (decision 6): the
   * customer pays the knowable amount; finalize later posts only the delta.
   */
  async markPaid(id: string) {
    const bill = await this.getOrThrow(id);
    if (bill.status === 'paid') {
      throw new ConflictException(`账单 ${bill.billNo} 已结清（${bill.paidAt?.toISOString().slice(0, 10) ?? ''}）`);
    }
    const amount = Number(bill.amount);

    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id: bill.customerId } });
      if (!customer) throw new NotFoundException('客户不存在');
      const before = Number(customer.balance);
      const after = round2(before + amount);

      const updated = await tx.customerBill.update({
        where: { id },
        data: { status: 'paid', paidAt: new Date() },
        include: { items: true, customer: { select: { code: true, name: true } } },
      });

      if (amount !== 0) {
        await tx.customerTransaction.create({
          data: {
            customerId: bill.customerId, type: 'payment', amount,
            description: `${bill.period} 账单 ${bill.billNo} 收款`,
          },
        });
        await tx.customer.update({ where: { id: bill.customerId }, data: { balance: after } });
      }

      await this.opLog.log({
        entityType: 'CustomerBill', entityId: id, action: 'MARK_PAID',
        beforeData: { status: 'unpaid', balance: before },
        afterData: { status: 'paid', balance: amount !== 0 ? after : before, amount, isProvisional: bill.isProvisional },
        description: `账单 ${bill.billNo} 标记已付 ${amount}${bill.isProvisional ? '（账单仍待确认）' : ''}`,
      }, tx);

      return { ...updated, balanceBefore: before, balanceAfter: amount !== 0 ? after : before };
    });
  }

  // ─── Read ───────────────────────────────────────────────────────────

  async listBills(q: ListBillsQueryDto = {}) {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 20));

    const where: Prisma.CustomerBillWhereInput = {};
    if (q.customerId) where.customerId = q.customerId;
    if (q.period) where.period = q.period;
    if (q.status) where.status = q.status;
    if (q.isProvisional !== undefined) where.isProvisional = q.isProvisional === 'true';

    const [data, total] = await this.prisma.$transaction([
      this.prisma.customerBill.findMany({
        where,
        include: { customer: { select: { code: true, name: true } }, items: true },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.customerBill.count({ where }),
    ]);
    return { data, pagination: { page, pageSize, total } };
  }

  async getBill(id: string) {
    const bill = await this.prisma.customerBill.findUnique({
      where: { id },
      include: { customer: { select: { code: true, name: true } }, items: true },
    });
    if (!bill) throw new NotFoundException('账单不存在');

    const { from, to } = this.window(bill.period);
    const [outboundOrders, receivingOrders] = await Promise.all([
      this.prisma.outboundOrder.count({
        where: { customerId: bill.customerId, status: { in: BILLABLE_OUTBOUND as any }, shippedAt: { gte: from, lt: to } },
      }),
      this.prisma.receivingOrder.count({
        where: { customerId: bill.customerId, status: { in: BILLABLE_RECEIVING as any }, updatedAt: { gte: from, lt: to } },
      }),
    ]);
    return { ...bill, sourceEvents: { outboundOrders, receivingOrders } };
  }

  // ─── The engine ─────────────────────────────────────────────────────

  /**
   * Price one customer-month. Pure with respect to the bill table: it reads
   * events, cards, tax rates and surcharge definitions, and returns lines. Both
   * generate() and finalize() go through here so a finalized bill is exactly what
   * a fresh generation with the same actuals would produce.
   */
  private async compute(
    customerId: string,
    period: string,
    actualsIn: ActualDto[],
    confirmations: ConfirmationCode[],
  ): Promise<Computed> {
    const { from, to } = this.window(period);
    // Prices (and tax rates, and surcharge windows) are resolved AS OF the end of
    // the period, so re-running a past month uses what was in force then.
    const at = new Date(to.getTime() - 1);
    const atIso = at.toISOString();

    const actuals: ActualCost[] = actualsIn.map((a) => ({ code: a.code, amount: a.amount }));
    const confirmed = new Set<ConfirmationCode>(confirmations);

    const warnings: string[] = [];
    const unpriced = new Map<string, number>();
    const bump = (key: string) => unpriced.set(key, (unpriced.get(key) ?? 0) + 1);

    // Monthly aggregates. BASE buckets keep the v4.38 shape (qty = events, avg
    // unit price); SURCHARGE and TAX buckets are keyed by code.
    const base = new Map<string, { qty: number; total: number; card?: string }>();
    const addBase = (feeType: string, amount: number, card?: string) => {
      const b = base.get(feeType) ?? { qty: 0, total: 0, card };
      b.qty += 1; b.total += amount; if (card) b.card = card;
      base.set(feeType, b);
    };
    const sur = new Map<string, { name: string; qty: number; total: number; pending: number; calcType: SurchargeCalcType }>();
    const tax = new Map<string, { taxType: string; jurisdiction: string; rate: number; qty: number; basis: number; total: number }>();

    let exportReview = 0;
    let unresolvedReview = 0;
    const pendingCodes = new Set<string>();

    const surchargeRows = await this.prisma.surcharge.findMany({
      where: {
        isActive: true,
        effectiveFrom: { lte: at },
        // HALF-OPEN windows [effectiveFrom, effectiveTo): effectiveTo is the first
        // instant the row NO LONGER applies. Exclusive here, and the period-end `at`
        // is the last instant of the month (23:59:59.999Z), so a row ending on the
        // month's last DAY covers it. An inclusive `gte` let the row's midnight
        // end-date fall short of the period-end instant — the NS 15→14 % boundary
        // bug the adversarial audit found (E4; see e4_billing_tax_additive.sql).
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
    });
    const taxCache = new Map<string, TaxRateDef[]>();
    const taxesFor = async (countryCode: string, jurisdiction: string): Promise<TaxRateDef[]> => {
      const key = `${countryCode}/${jurisdiction}`;
      if (!taxCache.has(key)) {
        const rows = await this.prisma.taxRate.findMany({
          where: {
            countryCode, jurisdiction, isActive: true,
            effectiveFrom: { lte: at },
            // Same half-open rule as surcharges above.
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
          },
          orderBy: { taxType: 'asc' },
        });
        taxCache.set(key, rows.map((r) => ({
          jurisdiction: r.jurisdiction, taxType: r.taxType, ratePercent: Number(r.ratePercent),
        })));
      }
      return taxCache.get(key)!;
    };

    /**
     * Run one event's priced lines through the charge assembler and fold the result
     * into the monthly buckets. `dest` decides the tax rows; a null jurisdiction is
     * the unresolvable case.
     */
    const fold = async (args: {
      freight: number | null; freightCard?: string;
      handling: { feeType: string; amount: number; card?: string } | null;
      dest: { countryCode: string | null; jurisdiction: string | null };
      carrier: string | null;
      appliesTo: Array<'SHIPPING' | 'HANDLING'>;
    }) => {
      const { freight, handling, dest } = args;
      if (freight !== null) addBase('SHIPPING', freight, args.freightCard);
      if (handling) addBase(handling.feeType, handling.amount, handling.card);

      let taxes: TaxRateDef[] = [];
      if (dest.countryCode && dest.jurisdiction) {
        taxes = await taxesFor(dest.countryCode, dest.jurisdiction);
        if (taxes.some((t) => t.taxType === 'EXPORT')) exportReview += 1;
      } else {
        unresolvedReview += 1;
      }

      const defs: SurchargeDef[] = surchargeRows
        .filter((s) => (s.appliesTo === 'ALL' || args.appliesTo.includes(s.appliesTo as any)))
        .filter((s) => !s.carrier || s.carrier === args.carrier)
        .map((s) => ({
          code: s.code, name: s.name, calcType: s.calcType as SurchargeCalcType,
          value: s.value === null ? null : Number(s.value), taxable: s.taxable, note: s.note,
        }));

      const bd = assembleCharges({
        base: freight ?? 0,
        surcharges: defs,
        taxes,
        actuals,
        additionalTaxableBase: handling
          ? [{ code: handling.feeType, name: LABEL[handling.feeType] ?? handling.feeType, amount: handling.amount }]
          : [],
      });

      for (const l of bd.lines) {
        if (l.kind === 'SURCHARGE') {
          const b = sur.get(l.code) ?? { name: l.name, qty: 0, total: 0, pending: 0, calcType: l.calcType! };
          b.qty += 1;
          if (l.pending) { b.pending += 1; pendingCodes.add(l.code); }
          else b.total += l.amount ?? 0;
          sur.set(l.code, b);
        } else if (l.kind === 'TAX') {
          const t = taxes.find((x) => `${x.taxType}_${x.jurisdiction}` === l.code)!;
          const b = tax.get(l.code) ?? { taxType: t.taxType, jurisdiction: t.jurisdiction, rate: t.ratePercent, qty: 0, basis: 0, total: 0 };
          b.qty += 1; b.basis += bd.taxableSubtotal; b.total += l.amount ?? 0;
          tax.set(l.code, b);
        }
      }
    };

    // ─── Outbound: handling + freight + surcharges + tax ──────────────
    const orders = await this.prisma.outboundOrder.findMany({
      where: {
        customerId,
        status: { in: BILLABLE_OUTBOUND as any },
        shippedAt: { gte: from, lt: to },
      },
    });

    for (const o of orders) {
      const weight = this.chargeableWeight(o);
      let handling: { feeType: string; amount: number; card?: string } | null = null;
      let freight: number | null = null;
      let freightCard: string | undefined;

      if (weight <= 0) {
        bump('出库单缺少重量，无法按重量档计费');
      } else {
        const h = await this.tryQuote({
          customerId, type: 'FULFILLMENT', itemCode: 'OUTBOUND_HANDLING',
          tierBasis: 'WEIGHT_KG', value: weight, quantity: 1, at: atIso,
        });
        if (h.amount === null) bump(`出库操作费无法计价：${h.reason}`);
        else handling = { feeType: 'OUTBOUND_HANDLING', amount: h.amount, card: h.card };

        if (!o.recipientZip) {
          bump('出库单缺少收件邮编，无法匹配运费分区');
        } else {
          const f = await this.tryQuote({
            customerId, type: 'SHIPPING', carrier: o.carrier ?? undefined,
            destination: o.recipientZip, tierBasis: 'WEIGHT_KG',
            value: weight, quantity: 1, at: atIso,
          });
          if (f.amount === null) bump(`基础运费无法计价：${f.reason}`);
          else { freight = f.amount; freightCard = f.card; }
        }
      }

      // An order that priced nothing has no taxable base; skip assembly so it
      // does not raise a tax-review flag on top of its UNPRICED line.
      if (freight === null && !handling) continue;

      await fold({
        freight, freightCard, handling,
        dest: normalizeDestination(o.recipientCountry, o.recipientProvince),
        carrier: o.carrier ?? null,
        appliesTo: ['SHIPPING', 'HANDLING'],
      });
    }

    // ─── Inbound: handling (+ tax at the warehouse's province) ────────
    const receipts = await this.prisma.receivingOrder.findMany({
      where: {
        customerId,
        status: { in: BILLABLE_RECEIVING as any },
        updatedAt: { gte: from, lt: to },
      },
      include: { items: { include: { product: true } }, warehouse: { select: { address: true } } },
    });

    for (const r of receipts) {
      const weight = r.items.reduce(
        (s, i) => s + Number(i.product.weight ?? 0) * (i.receivedQty ?? 0), 0,
      );
      if (weight <= 0) {
        bump('入库单商品未登记重量，无法按重量档计费');
        continue;
      }
      const q = await this.tryQuote({
        customerId, type: 'FULFILLMENT', itemCode: 'INBOUND_HANDLING',
        tierBasis: 'WEIGHT_KG', value: weight, quantity: 1, at: atIso,
      });
      if (q.amount === null) { bump(`入库操作费无法计价：${q.reason}`); continue; }

      await fold({
        freight: null,
        handling: { feeType: 'INBOUND_HANDLING', amount: q.amount, card: q.card },
        dest: parseWarehouseAddress(r.warehouse?.address),
        carrier: null,
        appliesTo: ['HANDLING'],
      });
    }

    // ─── Assemble the lines ───────────────────────────────────────────
    const lines: Line[] = [];

    for (const [feeType, b] of base) {
      lines.push({
        feeType,
        // unitPrice is an AVERAGE: each event was priced on its own weight band,
        // so there is no single unit price. The total is exact; this column is a
        // convenience and says so.
        description:
          `${LABEL[feeType] ?? feeType} · ${b.qty} 笔 · 按价卡「${b.card ?? '—'}」逐笔计价（单价为均价）`,
        qty: b.qty, unitPrice: round2(b.total / b.qty), totalAmount: round2(b.total),
        kind: 'BASE', isProvisional: false,
      });
    }

    for (const [code, b] of sur) {
      const pending = b.pending > 0;
      lines.push({
        feeType: code,
        description: pending
          ? `${b.name} · ${b.qty} 笔 · 实报实销，待录入承运商账单`
          : `${b.name} · ${b.qty} 笔${b.calcType === 'PASS_THROUGH' ? ' · 按承运商账单实报实销' : ''}`,
        qty: b.qty, unitPrice: pending ? 0 : round2(b.total / b.qty), totalAmount: round2(b.total),
        kind: 'SURCHARGE', isProvisional: pending,
      });
    }

    for (const [code, t] of tax) {
      const review = t.taxType === 'EXPORT' && !confirmed.has('EXPORT_ZERO_RATED');
      lines.push({
        feeType: code,
        description: `销售税 ${t.taxType} ${t.rate}%（${t.jurisdiction}）· ${t.qty} 笔 · 计税基数 ${round2(t.basis)}` +
          (t.taxType === 'EXPORT' ? ' · 出口零税率' : ''),
        qty: t.qty, unitPrice: round2(t.basis), totalAmount: round2(t.total),
        kind: 'TAX', isProvisional: review,
      });
    }

    for (const [reason, count] of unpriced) {
      warnings.push(`${reason}（${count} 笔）`);
      lines.push({
        feeType: 'UNPRICED', description: `待人工核价：${reason}`,
        qty: count, unitPrice: 0, totalAmount: 0, kind: 'UNPRICED', isProvisional: false,
      });
    }

    // ─── Review flags → warnings + provisional ────────────────────────
    const pendingConfirmations: ConfirmationCode[] = [];
    for (const code of pendingCodes) {
      const s = sur.get(code)!;
      warnings.push(`${s.name}（${code}）为实报实销，尚未收到承运商账单，未计入合计（${s.pending} 笔）`);
    }
    if (exportReview > 0) {
      if (confirmed.has('EXPORT_ZERO_RATED')) warnings.push(`出口零税率已人工确认（${exportReview} 笔）`);
      else { warnings.push(`出口零税率，待人工复核（${exportReview} 笔）`); pendingConfirmations.push('EXPORT_ZERO_RATED'); }
    }
    if (unresolvedReview > 0) {
      if (confirmed.has('TAX_REVIEW_ACCEPTED')) warnings.push(`目的地无法识别、按未计税处理已人工确认（${unresolvedReview} 笔）`);
      else { warnings.push(`目的地省份/国家无法识别，该单未计税（${unresolvedReview} 笔）`); pendingConfirmations.push('TAX_REVIEW_ACCEPTED'); }
    }
    warnings.push(STORAGE_WAIVER);

    const total = round2(lines.reduce((s, l) => s + l.totalAmount, 0));
    const isProvisional = pendingCodes.size > 0 || pendingConfirmations.length > 0;

    return {
      lines, total, warnings, isProvisional,
      pendingCodes: [...pendingCodes], pendingConfirmations,
      sourceEvents: { outboundOrders: orders.length, receivingOrders: receipts.length },
    };
  }

  // ─── helpers ────────────────────────────────────────────────────────

  private window(period: string) {
    const [y, m] = period.split('-').map(Number);
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1));
    return { from, to };
  }

  private async getOrThrow(id: string) {
    const bill = await this.prisma.customerBill.findUnique({ where: { id } });
    if (!bill) throw new NotFoundException('账单不存在');
    return bill;
  }

  /**
   * Sequential per period: BILL-YYYYMM-NNNN.
   *
   * Derived from the highest EXISTING number for the period rather than from a
   * row count — a count regenerates a used number as soon as any middle bill is
   * deleted. Same bug class as receivingNo/taskNo/exceptionNo (report v4.28).
   */
  private async nextBillNo(tx: any, period: string): Promise<string> {
    const prefix = `BILL-${period.replace('-', '')}-`;
    const last = await tx.customerBill.findFirst({
      where: { billNo: { startsWith: prefix } },
      orderBy: { billNo: 'desc' },
      select: { billNo: true },
    });
    return nextDocNo(prefix, last?.billNo ?? null);
  }

  /** max(actual, volumetric), preferring the figures packing actually recorded. */
  private chargeableWeight(o: {
    packageBillingWeight: any; packageActualWeight: any; totalWeightKg: any;
    packageLength: any; packageWidth: any; packageHeight: any;
  }): number {
    const billing = Number(o.packageBillingWeight ?? 0);
    if (billing > 0) return billing; // packing already settled it
    const actual = Number(o.packageActualWeight ?? 0) || Number(o.totalWeightKg ?? 0);
    const vol =
      (Number(o.packageLength ?? 0) * Number(o.packageWidth ?? 0) * Number(o.packageHeight ?? 0)) /
      VOLUMETRIC_DIVISOR;
    return Math.max(actual, vol);
  }

  /**
   * quote() but non-fatal: one unpriceable order must not abort a whole month's
   * bill, so the reason is returned and recorded as a line instead.
   */
  private async tryQuote(args: any): Promise<{ amount: number | null; card?: string; reason: string }> {
    try {
      const q = await this.rateCards.quote(args);
      if (q.quoteOnRequest || q.amount === null) {
        return { amount: null, card: q.rateCardName, reason: '该区间为面议价' };
      }
      return { amount: q.amount, card: q.rateCardName, reason: '' };
    } catch (e: any) {
      return { amount: null, reason: e?.message ?? '未知错误' };
    }
  }
}
