import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RateCardsService } from '../rate-cards/rate-cards.service';
import { CalculateFeeDto } from './dto/calculate-fee.dto';

/**
 * Shipping fee estimation.
 *
 * Prices now come from the Rate Card system (RateCardsService.quote); the
 * hardcoded three-value `rateMatrix` is off the happy path.
 *
 * It survives ONLY as a labelled fallback: until real cards are loaded a SHIPPING
 * lookup finds nothing, and erroring outright would break the calculator. Every
 * fallback response is stamped `source: 'FALLBACK_MATRIX'` + `isEstimate: true`,
 * so a placeholder can never be mistaken for a quoted price. Delete the fallback
 * once cards are live.
 */

const FALLBACK_RATES: Record<string, number> = {
  AIR: 5.5, // per kg
  SEA: 1.2,
  EXPRESS: 8.0,
};
const DEFAULT_FALLBACK_RATE = 5.0;

// cm³ → volumetric kg. Matches BoxesService.measure, so a parcel is never quoted
// on one divisor and billed on another.
const VOLUMETRIC_DIVISOR = 5000;

// Units whose price is multiplied by the chargeable weight; anything else
// (PER_ORDER, PER_ITEM …) is a flat figure for the whole band.
const WEIGHT_SCALED = new Set(['PER_KG']);

// The request shape lives in CalculateFeeDto, where class-validator can enforce
// it. `origin` is deliberately NOT derived from warehouseId: the zone tables key
// on each carrier's own origin labels (多伦多 / 温哥华) and no mapping from our
// Warehouse rows to those labels exists yet, so it is passed explicitly.
export type CalculateFeeBody = CalculateFeeDto;

@Injectable()
export class FeeService {
  constructor(
    private prisma: PrismaService,
    private rateCards: RateCardsService,
  ) {}

  async calculateFee(body: CalculateFeeBody) {
    const { totalWeight, totalVolume } = await this.measure(body);

    const chargeableWeight = Math.max(totalWeight, totalVolume / VOLUMETRIC_DIVISOR);
    const base = {
      shippingMode: body.shippingMode ?? 'EXPRESS',
      totalWeight: round2(totalWeight),
      totalVolume: round2(totalVolume),
      volumetricWeight: round2(totalVolume / VOLUMETRIC_DIVISOR),
      chargeableWeight: round2(chargeableWeight),
      // Which of the two won — the single most-asked question about any freight
      // quote, and the page should not have to re-derive it.
      chargeableBasis: totalVolume / VOLUMETRIC_DIVISOR > totalWeight ? 'VOLUMETRIC' : 'ACTUAL',
    };

    if (!body.destination) {
      return this.fallback(base, chargeableWeight, '未提供目的地邮编（destination），无法匹配运费分区');
    }

    try {
      const ask = (quantity: number) =>
        this.rateCards.quote({
          customerId: body.customerId,
          type: 'SHIPPING',
          carrier: body.carrier,
          destination: body.destination,
          origin: body.origin,
          tierBasis: 'WEIGHT_KG',
          value: chargeableWeight,
          quantity,
          at: body.at,
        });

      // The band decides whether weight scales the price, so quote once to learn
      // the unit, then re-quote only when it turns out to be weight-scaled.
      const probe = await ask(1);
      const q = WEIGHT_SCALED.has(probe.chargeUnit) ? await ask(chargeableWeight) : probe;

      return {
        ...base,
        estimatedFee: q.amount,
        currency: q.currency,
        source: 'RATE_CARD' as const,
        isEstimate: false,
        quoteOnRequest: q.quoteOnRequest,
        rateCard: {
          id: q.rateCardId,
          name: q.rateCardName,
          resolvedFrom: q.source, // CUSTOMER | DEFAULT
          zone: q.zone,
          unitPrice: q.unitPrice,
          // The undiscounted rate is kept alongside so a bill can show what the
          // list price was and what the contract multiplier did to it.
          listUnitPrice: (q as any).listUnitPrice ?? q.unitPrice,
          discountRatio: (q as any).discountRatio ?? 1,
          chargeUnit: q.chargeUnit,
          band: { from: q.rangeStart, to: q.rangeEnd },
          minFeeApplied: (q as any).minFeeApplied ?? false,
        },
        details: q.quoteOnRequest
          ? '该区间为面议价，需人工报价'
          : `按价卡「${q.rateCardName}」${q.zone} 区计费`,
      };
    } catch (e: any) {
      // No card / no zone / no band. Fall through rather than failing the whole
      // calculator, but echo the reason so the gap is visible, not silent.
      return this.fallback(base, chargeableWeight, e?.message);
    }
  }

  /**
   * Weight and volume, from SKUs when given and from typed-in measurements
   * otherwise. The calculator is used before an order exists at least as often as
   * after one, so requiring productIds would make it unusable for its main job.
   */
  private async measure(body: CalculateFeeBody) {
    if (body.items?.length) {
      let totalWeight = 0;
      let totalVolume = 0;
      for (const item of body.items) {
        const product = await this.prisma.product.findUnique({ where: { id: item.productId } });
        if (!product) throw new NotFoundException(`Product ${item.productId} not found`);
        totalWeight += Number(product.weight || 0) * item.qty;
        const volume =
          Number(product.length || 0) * Number(product.width || 0) * Number(product.height || 0);
        totalVolume += volume * item.qty;
      }
      return { totalWeight, totalVolume };
    }

    if (body.actualWeightKg === undefined || body.actualWeightKg === null) {
      throw new BadRequestException(
        '请提供商品明细（items）或直接填写实重（actualWeightKg）',
      );
    }

    const pieces = body.pieces ?? 1;
    const dims = [body.length, body.width, body.height];
    // Partial dimensions are a data-entry slip, not a zero-volume parcel: silently
    // treating L×W with no H as 0 would quote a volumetric weight of 0 and could
    // under-bill a large light carton.
    const given = dims.filter((d) => d !== undefined && d !== null).length;
    if (given > 0 && given < 3) {
      throw new BadRequestException('体积尺寸需三边齐全（length / width / height），或全部留空');
    }

    const oneVolume = given === 3 ? Number(body.length) * Number(body.width) * Number(body.height) : 0;
    return {
      totalWeight: Number(body.actualWeightKg) * pieces,
      totalVolume: oneVolume * pieces,
    };
  }

  private fallback(
    base: Record<string, unknown>,
    chargeableWeight: number,
    reason?: string,
  ) {
    const rate = FALLBACK_RATES[String(base.shippingMode)] ?? DEFAULT_FALLBACK_RATE;
    return {
      ...base,
      estimatedFee: round2(chargeableWeight * rate),
      currency: 'USD',
      source: 'FALLBACK_MATRIX' as const,
      isEstimate: true,
      quoteOnRequest: false,
      rateCard: null,
      fallbackReason: reason,
      details: '未命中价卡，使用占位费率估算，不可用于对外报价',
    };
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
