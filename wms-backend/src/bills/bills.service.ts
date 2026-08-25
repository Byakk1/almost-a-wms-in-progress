import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RateCardsService } from '../rate-cards/rate-cards.service';
import { OperationLogService } from '../common/operation-log.service';
import { isUniqueViolation, nextDocNo } from '../common/doc-no';

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
 *
 * ── What is deliberately NOT billed ──────────────────────────────────
 *
 * STORAGE. The card prices it per CBM·day (STORAGE_DROPSHIP, tierBasis
 * STORAGE_DAYS), which needs the volume held on each day of the period. Nothing
 * in the schema records that: Inventory holds only a CURRENT snapshot, and
 * multiplying today's stock by the days in the month would bill a customer who
 * cleared their inventory on the 2nd for a full month.
 *
 * Deriving it from InventoryTransaction would need that ledger to be complete for
 * the whole period, which it is not for any historical month. Producing a
 * confidently wrong storage charge is worse than producing none, so the bill
 * reports storage as unbilled and says why. Closing this needs a daily snapshot
 * table — see the report's open items.
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

type Line = {
  feeType: string;
  description: string;
  qty: number;
  unitPrice: number;
  totalAmount: number;
};

@Injectable()
export class BillsService {
  constructor(
    private prisma: PrismaService,
    private rateCards: RateCardsService,
    private opLog: OperationLogService,
  ) {}

  async generateMonthlyBill(customerId: string, period: string) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      throw new BadRequestException(`账期格式应为 YYYY-MM，收到 ${period}`);
    }

    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundException('客户不存在');

    const existing = await this.prisma.customerBill.findFirst({ where: { customerId, period } });
    if (existing) {
      throw new BadRequestException(`客户 ${customer.name} 的 ${period} 账单已存在（${existing.billNo}）`);
    }

    const [y, m] = period.split('-').map(Number);
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1));

    // Prices are resolved AS OF the end of the period, so re-running a past month
    // uses the card that was in force then rather than today's.
    const at = new Date(to.getTime() - 1).toISOString();

    const warnings: string[] = [];
    const buckets = new Map<string, { qty: number; total: number; card?: string }>();
    const add = (feeType: string, amount: number, card?: string) => {
      const b = buckets.get(feeType) ?? { qty: 0, total: 0, card };
      b.qty += 1;
      b.total += amount;
      if (card) b.card = card;
      buckets.set(feeType, b);
    };
    const unpriced = new Map<string, number>();
    const bump = (key: string) => unpriced.set(key, (unpriced.get(key) ?? 0) + 1);

    // ─── Outbound: handling + freight ─────────────────────────────────
    const orders = await this.prisma.outboundOrder.findMany({
      where: {
        customerId,
        status: { in: BILLABLE_OUTBOUND as any },
        shippedAt: { gte: from, lt: to },
      },
    });

    for (const o of orders) {
      const weight = this.chargeableWeight(o);

      if (weight <= 0) {
        bump('出库单缺少重量，无法按重量档计费');
      } else {
        const h = await this.tryQuote({
          customerId, type: 'FULFILLMENT', itemCode: 'OUTBOUND_HANDLING',
          tierBasis: 'WEIGHT_KG', value: weight, quantity: 1, at,
        });
        if (h.amount === null) bump(`出库操作费无法计价：${h.reason}`);
        else add('OUTBOUND_HANDLING', h.amount, h.card);
      }

      if (!o.recipientZip) {
        bump('出库单缺少收件邮编，无法匹配运费分区');
      } else if (weight <= 0) {
        // already counted above
      } else {
        const f = await this.tryQuote({
          customerId, type: 'SHIPPING', carrier: o.carrier ?? undefined,
          destination: o.recipientZip, tierBasis: 'WEIGHT_KG',
          value: weight, quantity: 1, at,
        });
        if (f.amount === null) bump(`基础运费无法计价：${f.reason}`);
        else add('SHIPPING', f.amount, f.card);
      }
    }

    // ─── Inbound: handling ────────────────────────────────────────────
    const receipts = await this.prisma.receivingOrder.findMany({
      where: {
        customerId,
        status: { in: BILLABLE_RECEIVING as any },
        updatedAt: { gte: from, lt: to },
      },
      include: { items: { include: { product: true } } },
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
        tierBasis: 'WEIGHT_KG', value: weight, quantity: 1, at,
      });
      if (q.amount === null) bump(`入库操作费无法计价：${q.reason}`);
      else add('INBOUND_HANDLING', q.amount, q.card);
    }

    // ─── Assemble the lines ───────────────────────────────────────────
    const LABEL: Record<string, string> = {
      OUTBOUND_HANDLING: '出库操作费',
      SHIPPING: '基础运费',
      INBOUND_HANDLING: '入库操作费',
    };

    const lines: Line[] = [];
    for (const [feeType, b] of buckets) {
      lines.push({
        feeType,
        // unitPrice is an AVERAGE: each event was priced on its own weight band,
        // so there is no single unit price. The total is exact; this column is a
        // convenience and says so.
        description:
          `${LABEL[feeType] ?? feeType} · ${b.qty} 笔 · 按价卡「${b.card ?? '—'}」逐笔计价（单价为均价）`,
        qty: b.qty,
        unitPrice: round2(b.total / b.qty),
        totalAmount: round2(b.total),
      });
    }

    for (const [reason, count] of unpriced) {
      warnings.push(`${reason}（${count} 笔）`);
      lines.push({
        feeType: 'UNPRICED',
        description: `待人工核价：${reason}`,
        qty: count,
        unitPrice: 0,
        totalAmount: 0,
      });
    }

    warnings.push(
      '仓储费未计入：价卡按 CBM·天 计价，而系统没有逐日库存快照，' +
      '用当前库存乘以账期天数会对月初即清仓的客户超收。需补日快照表后另行结算。',
    );

    const total = round2(lines.reduce((s, l) => s + l.totalAmount, 0));

    // ─── Persist ──────────────────────────────────────────────────────
    // The whole transaction is retried on a billNo collision: retrying inside it
    // would run against an already-aborted transaction.
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const billNo = await this.nextBillNo(tx, period);

          const bill = await tx.customerBill.create({
            data: {
              billNo, customerId, period, amount: total, status: 'unpaid',
              dueDate: new Date(to.getTime() + 15 * 24 * 60 * 60 * 1000),
              items: { create: lines },
            },
            include: { items: true },
          });

          // The balance is the point of a bill. Posting it here — in the same
          // transaction — is what makes the customer's account reflect what they
          // owe; previously a "generated" bill moved no money at all.
          const before = Number(customer.balance);
          const after = round2(before - total);
          if (total > 0) {
            await tx.customerTransaction.create({
              data: {
                customerId, type: 'deduction', amount: -total,
                description: `${period} 月度账单 ${billNo}`,
              },
            });
            await tx.customer.update({ where: { id: customerId }, data: { balance: after } });
          }

          await this.opLog.log({
            entityType: 'CustomerBill', entityId: bill.id, action: 'GENERATE',
            beforeData: { balance: before },
            afterData: { balance: total > 0 ? after : before, amount: total, billNo },
            description:
              `生成 ${period} 账单 ${billNo}，共 ${lines.length} 项，合计 ${total}` +
              `${warnings.length ? `，${warnings.length} 项提示` : ''}`,
          }, tx);

          return {
            ...bill,
            balanceBefore: before,
            balanceAfter: total > 0 ? after : before,
            sourceEvents: { outboundOrders: orders.length, receivingOrders: receipts.length },
            warnings,
          };
        });
      } catch (e) {
        if (isUniqueViolation(e) && attempt < 4) continue;
        throw e;
      }
    }
    throw new BadRequestException('账单号生成冲突，请重试');
  }

  async listBills(customerId?: string) {
    const where = customerId ? { customerId } : {};
    return this.prisma.customerBill.findMany({
      where,
      include: { customer: { select: { code: true, name: true } }, items: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── helpers ────────────────────────────────────────────────────────

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
