import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OperationLogService } from '../common/operation-log.service';
import { assertTransition, RATE_CARD_TRANSITIONS } from '../common/state-machine';
import { CreateRateCardDto, RateCardItemDto, ShippingZoneDto } from './dto/create-rate-card.dto';
import {
  AddRateCardItemsDto, AddShippingZonesDto, AssignRateCardDto, QuoteDto,
} from './dto/rate-card-ops.dto';

const ENTITY = 'RateCard';

/** rangeStart/rangeEnd are nullable Decimals meaning 0 and +∞ respectively. */
const lo = (v: any): number => (v === null || v === undefined ? 0 : Number(v));
const hi = (v: any): number => (v === null || v === undefined ? Infinity : Number(v));

/** Money rounds to 2dp at the boundary; unitPrice keeps its stored 4dp precision. */
const money = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

@Injectable()
export class RateCardsService {
  constructor(
    private prisma: PrismaService,
    private opLog: OperationLogService,
  ) {}

  // ─── Read ───────────────────────────────────────────────────────────

  async list(q: {
    page?: number; pageSize?: number;
    type?: string; status?: string; carrier?: string; customerId?: string;
  }) {
    const page = Number(q.page) || 1;
    const pageSize = Math.min(Number(q.pageSize) || 20, 200);

    const where: any = {};
    if (q.type) where.type = q.type;
    if (q.status) where.status = q.status;
    if (q.carrier) where.carrier = q.carrier;
    if (q.customerId) where.customers = { some: { customerId: q.customerId } };

    const [rows, total] = await Promise.all([
      this.prisma.rateCard.findMany({
        where,
        orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { items: true, zones: true, customers: true } } },
      }),
      this.prisma.rateCard.count({ where }),
    ]);

    return {
      data: rows.map((r) => ({
        ...r,
        itemCount: r._count.items,
        zoneCount: r._count.zones,
        customerCount: r._count.customers,
        _count: undefined,
      })),
      pagination: { page, pageSize, total },
    };
  }

  async findOne(id: string) {
    const card = await this.prisma.rateCard.findUnique({
      where: { id },
      include: {
        items: { orderBy: [{ itemCode: 'asc' }, { zone: 'asc' }, { rangeStart: 'asc' }] },
        customers: { include: { customer: { select: { code: true, name: true } } } },
        // A SHIPPING card can hold thousands of zone rows; the count is on the list
        // endpoint and the rows are paged separately by listZones().
        _count: { select: { zones: true } },
      },
    });
    if (!card) throw new NotFoundException('价卡不存在');
    return {
      ...card,
      zoneCount: card._count.zones,
      _count: undefined,
      customers: card.customers.map((c) => ({
        customerId: c.customerId,
        customerCode: c.customer.code,
        customerName: c.customer.name,
        priority: c.priority,
      })),
    };
  }

  async listZones(id: string, q: { page?: number; pageSize?: number; zone?: string }) {
    const page = Number(q.page) || 1;
    const pageSize = Math.min(Number(q.pageSize) || 50, 500);
    const where: any = { rateCardId: id };
    if (q.zone) where.zone = q.zone;

    const [data, total] = await Promise.all([
      this.prisma.shippingZone.findMany({
        where, orderBy: { destination: 'asc' },
        skip: (page - 1) * pageSize, take: pageSize,
      }),
      this.prisma.shippingZone.count({ where }),
    ]);
    return { data, pagination: { page, pageSize, total } };
  }

  // ─── Write ──────────────────────────────────────────────────────────

  async create(dto: CreateRateCardDto) {
    if (dto.type === 'SHIPPING' && !dto.carrier) {
      throw new BadRequestException('运费价卡必须指定承运商（carrier）');
    }
    (dto.items ?? []).forEach(assertPriceIsKnown);

    const card = await this.prisma.$transaction(async (tx) => {
      const created = await tx.rateCard.create({
        data: {
          name: dto.name,
          type: dto.type,
          carrier: dto.carrier ?? null,
          currency: dto.currency ?? 'CAD',
          isDefault: dto.isDefault ?? false,
          effectiveAt: new Date(dto.effectiveAt),
          expiredAt: dto.expiredAt ? new Date(dto.expiredAt) : null,
          note: dto.note ?? null,
          // status defaults to DRAFT — a card is never born ACTIVE, because
          // activate() is what validates its tiers.
        },
      });
      if (dto.items?.length) {
        await tx.rateCardItem.createMany({ data: dto.items.map((i) => itemRow(created.id, i)) });
      }
      if (dto.zones?.length) {
        await tx.shippingZone.createMany({ data: dto.zones.map((z) => zoneRow(created.id, z)) });
      }
      await this.opLog.log({
        entityType: ENTITY, entityId: created.id, action: 'CREATE',
        afterData: { name: created.name, type: created.type, status: created.status },
        description: `创建价卡 ${created.name}（${created.type}）`,
      }, tx);
      return created;
    });

    return this.findOne(card.id);
  }

  async addItems(id: string, dto: AddRateCardItemsDto) {
    const card = await this.mustBeDraft(id, '追加价卡明细');
    dto.items.forEach(assertPriceIsKnown);
    await this.prisma.rateCardItem.createMany({
      data: dto.items.map((i) => itemRow(card.id, i)),
    });
    return this.findOne(card.id);
  }

  async addZones(id: string, dto: AddShippingZonesDto) {
    const card = await this.mustBeDraft(id, '追加分区');
    if (card.type !== 'SHIPPING') {
      throw new BadRequestException(`只有运费价卡可以配置分区，当前类型 [${card.type}]`);
    }
    // skipDuplicates keeps a re-run of a chunked import idempotent — the unique
    // index is (rateCardId, destination).
    const res = await this.prisma.shippingZone.createMany({
      data: dto.zones.map((z) => zoneRow(card.id, z)),
      skipDuplicates: true,
    });
    return { rateCardId: card.id, inserted: res.count, submitted: dto.zones.length };
  }

  async removeItem(itemId: string) {
    const item = await this.prisma.rateCardItem.findUnique({
      where: { id: itemId }, include: { rateCard: true },
    });
    if (!item) throw new NotFoundException('价卡明细不存在');
    if (item.rateCard.status !== 'DRAFT') {
      throw new BadRequestException(
        `价卡 [${item.rateCard.status}] 的明细不可删除，改价请新建一张生效日期更晚的价卡`,
      );
    }
    await this.prisma.rateCardItem.delete({ where: { id: itemId } });
    return { id: itemId, deleted: true };
  }

  /**
   * DRAFT → ACTIVE. This is the gate: tiers are validated here, once, and the
   * prices are frozen from this point on.
   */
  async activate(id: string) {
    const card = await this.prisma.rateCard.findUnique({ where: { id }, include: { items: true } });
    if (!card) throw new NotFoundException('价卡不存在');
    assertTransition(card.status, 'ACTIVE', RATE_CARD_TRANSITIONS, '价卡');
    if (!card.items.length) throw new BadRequestException('价卡没有任何明细，无法启用');
    if (card.type === 'SHIPPING') {
      const zones = await this.prisma.shippingZone.count({ where: { rateCardId: id } });
      if (!zones) throw new BadRequestException('运费价卡未配置任何分区（ShippingZone），无法启用');
    }

    assertTiersAreSound(card.items);

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.rateCard.update({ where: { id }, data: { status: 'ACTIVE' } });
      await this.opLog.log({
        entityType: ENTITY, entityId: id, action: 'ACTIVATE',
        beforeData: { status: card.status }, afterData: { status: u.status },
        description: `启用价卡 ${u.name}，${card.items.length} 条明细自此冻结`,
      }, tx);
      return u;
    });
    return updated;
  }

  async archive(id: string) {
    const card = await this.prisma.rateCard.findUnique({ where: { id } });
    if (!card) throw new NotFoundException('价卡不存在');
    assertTransition(card.status, 'ARCHIVED', RATE_CARD_TRANSITIONS, '价卡');

    return this.prisma.$transaction(async (tx) => {
      const u = await tx.rateCard.update({ where: { id }, data: { status: 'ARCHIVED' } });
      await this.opLog.log({
        entityType: ENTITY, entityId: id, action: 'ARCHIVE',
        beforeData: { status: card.status }, afterData: { status: u.status },
        description: `归档价卡 ${u.name}`,
      }, tx);
      return u;
    });
  }

  // ─── Assignment ─────────────────────────────────────────────────────

  async assign(dto: AssignRateCardDto) {
    const [customer, card] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: dto.customerId } }),
      this.prisma.rateCard.findUnique({ where: { id: dto.rateCardId } }),
    ]);
    if (!customer) throw new NotFoundException('客户不存在');
    if (!card) throw new NotFoundException('价卡不存在');
    if (card.status === 'ARCHIVED') throw new BadRequestException('已归档的价卡不能分配给客户');

    const link = await this.prisma.customerRateCard.upsert({
      where: { customerId_rateCardId: { customerId: dto.customerId, rateCardId: dto.rateCardId } },
      update: { priority: dto.priority ?? 0 },
      create: { customerId: dto.customerId, rateCardId: dto.rateCardId, priority: dto.priority ?? 0 },
    });
    await this.opLog.log({
      entityType: ENTITY, entityId: dto.rateCardId, action: 'ASSIGN',
      afterData: { customerId: dto.customerId, priority: link.priority },
      description: `价卡 ${card.name} 分配给客户 ${customer.name}（优先级 ${link.priority}）`,
    });
    return link;
  }

  async unassign(customerId: string, rateCardId: string) {
    const link = await this.prisma.customerRateCard.findUnique({
      where: { customerId_rateCardId: { customerId, rateCardId } },
    });
    if (!link) throw new NotFoundException('该客户未分配此价卡');
    await this.prisma.customerRateCard.delete({ where: { id: link.id } });
    await this.opLog.log({
      entityType: ENTITY, entityId: rateCardId, action: 'UNASSIGN',
      beforeData: { customerId, priority: link.priority },
      description: `解除客户 ${customerId} 的价卡绑定`,
    });
    return { customerId, rateCardId, deleted: true };
  }

  // ─── The engine ─────────────────────────────────────────────────────

  /**
   * Which card applies to this customer, for this fee type, at this instant?
   *
   * Customer assignment first (highest priority wins), then the default list
   * price. `at` defaults to now but is a parameter so a bill reprinted next year
   * still resolves to the prices that were live when it was issued.
   */
  async resolveCard(params: {
    customerId?: string; type: string; carrier?: string; at?: Date;
  }) {
    const at = params.at ?? new Date();
    const dated = {
      type: params.type,
      status: 'ACTIVE',
      effectiveAt: { lte: at },
      OR: [{ expiredAt: null }, { expiredAt: { gt: at } }],
      ...(params.carrier ? { carrier: params.carrier } : {}),
    };

    if (params.customerId) {
      const assigned = await this.prisma.customerRateCard.findMany({
        where: { customerId: params.customerId, rateCard: dated },
        include: { rateCard: true },
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        take: 1,
      });
      if (assigned.length) return { card: assigned[0].rateCard, source: 'CUSTOMER' as const };
    }

    const fallback = await this.prisma.rateCard.findFirst({
      where: { ...dated, isDefault: true },
      orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }],
    });
    if (!fallback) {
      throw new NotFoundException(
        `未找到适用的价卡：type=${params.type}` +
        `${params.carrier ? ` carrier=${params.carrier}` : ''}` +
        `${params.customerId ? ` customer=${params.customerId}` : ''}` +
        `，且没有可用的默认价卡`,
      );
    }
    return { card: fallback, source: 'DEFAULT' as const };
  }

  /** What does this cost? Resolves the card, matches the tier, computes the amount. */
  async quote(dto: QuoteDto) {
    const at = dto.at ? new Date(dto.at) : new Date();
    const { card, source } = await this.resolveCard({
      customerId: dto.customerId, type: dto.type, carrier: dto.carrier, at,
    });

    // SHIPPING: postcode → zone is the first of two lookups.
    let zone: string | null = null;
    if (card.type === 'SHIPPING') {
      if (!dto.destination) throw new BadRequestException('运费询价必须提供目的地（destination）');
      zone = await this.resolveZone(card.id, dto.destination);
      if (!zone) {
        throw new NotFoundException(
          `目的地 ${dto.destination} 不在价卡 ${card.name} 的分区表中`,
        );
      }
    }

    const where: any = { rateCardId: card.id };
    if (dto.itemCode) where.itemCode = dto.itemCode;
    if (zone) where.zone = zone;
    if (dto.tierBasis) where.tierBasis = dto.tierBasis;

    const candidates = await this.prisma.rateCardItem.findMany({
      where, orderBy: { rangeStart: 'asc' },
    });
    if (!candidates.length) {
      throw new NotFoundException(
        `价卡 ${card.name} 中没有匹配的计费项` +
        `${dto.itemCode ? `（itemCode=${dto.itemCode}）` : ''}${zone ? `（zone=${zone}）` : ''}`,
      );
    }

    const flat = candidates.filter((c) => c.tierBasis === 'NONE');
    const tiered = candidates.filter((c) => c.tierBasis !== 'NONE');

    let item: (typeof candidates)[number] | undefined;
    if (tiered.length) {
      if (dto.value === undefined || dto.value === null) {
        throw new BadRequestException(
          `该计费项按 ${tiered[0].tierBasis} 分梯度，必须提供计费数值（value）`,
        );
      }
      const v = Number(dto.value);
      item = tiered.find((c) => v >= lo(c.rangeStart) && v < hi(c.rangeEnd));
      if (!item) {
        throw new NotFoundException(
          `计费数值 ${v} 未落入价卡 ${card.name} 的任何梯度区间`,
        );
      }
    } else {
      if (flat.length > 1 && !dto.itemCode) {
        throw new BadRequestException(
          `价卡 ${card.name} 有 ${flat.length} 个计费项，请用 itemCode 指定`,
        );
      }
      item = flat[0];
    }

    const quantity = dto.quantity === undefined ? 1 : Number(dto.quantity);

    if (item.quoteOnRequest || item.unitPrice === null) {
      return {
        rateCardId: card.id, rateCardName: card.name, source, currency: card.currency,
        zone, itemId: item.id, itemCode: item.itemCode, itemName: item.itemName,
        chargeUnit: item.chargeUnit, tierBasis: item.tierBasis,
        rangeStart: item.rangeStart, rangeEnd: item.rangeEnd,
        unitPrice: null, quantity, amount: null,
        quoteOnRequest: true, note: item.note,
        // Deliberately NOT 0 — a 面议 line billed as zero is a silent revenue leak.
        message: '该项为面议价，需人工报价',
      };
    }

    const raw = Number(item.unitPrice) * quantity;
    const minFee = item.minFee === null ? null : Number(item.minFee);
    const amount = minFee !== null && raw < minFee ? minFee : raw;

    return {
      rateCardId: card.id, rateCardName: card.name, source, currency: card.currency,
      zone, itemId: item.id, itemCode: item.itemCode, itemName: item.itemName,
      chargeUnit: item.chargeUnit, tierBasis: item.tierBasis,
      rangeStart: item.rangeStart, rangeEnd: item.rangeEnd,
      unitPrice: Number(item.unitPrice), quantity,
      amount: money(amount),
      minFeeApplied: minFee !== null && raw < minFee,
      quoteOnRequest: false, note: item.note,
    };
  }

  /** Longest-prefix match: V6B beats V6 beats V. */
  private async resolveZone(rateCardId: string, destination: string): Promise<string | null> {
    const key = destination.replace(/\s+/g, '').toUpperCase();
    const prefixes: string[] = [];
    for (let n = key.length; n > 0; n--) prefixes.push(key.slice(0, n));

    const rows = await this.prisma.shippingZone.findMany({
      where: { rateCardId, destination: { in: prefixes } },
    });
    if (!rows.length) return null;
    rows.sort((a, b) => b.destination.length - a.destination.length);
    return rows[0].zone;
  }

  // ─── helpers ────────────────────────────────────────────────────────

  private async mustBeDraft(id: string, action: string) {
    const card = await this.prisma.rateCard.findUnique({ where: { id } });
    if (!card) throw new NotFoundException('价卡不存在');
    if (card.status !== 'DRAFT') {
      throw new BadRequestException(
        `价卡状态 [${card.status}] 不允许${action}，只有草稿价卡可以修改；` +
        `改价请新建一张生效日期更晚的价卡`,
      );
    }
    return card;
  }
}

// ─── module-level pure helpers ────────────────────────────────────────

function assertPriceIsKnown(i: RateCardItemDto) {
  const priced = i.unitPrice !== undefined && i.unitPrice !== null;
  if (!priced && !i.quoteOnRequest) {
    throw new BadRequestException(
      `计费项缺少单价：${i.itemCode ?? i.itemName ?? '(未命名)'}。` +
      `若确为面议价，请显式设置 quoteOnRequest=true`,
    );
  }
}

function itemRow(rateCardId: string, i: RateCardItemDto) {
  return {
    rateCardId,
    itemCode: i.itemCode ?? null,
    itemName: i.itemName ?? null,
    zone: i.zone ?? null,
    tierBasis: i.tierBasis ?? 'NONE',
    rangeStart: i.rangeStart ?? null,
    rangeEnd: i.rangeEnd ?? null,
    chargeUnit: i.chargeUnit,
    unitPrice: i.unitPrice ?? null,
    minFee: i.minFee ?? null,
    quoteOnRequest: i.quoteOnRequest ?? false,
    note: i.note ?? null,
  };
}

function zoneRow(rateCardId: string, z: ShippingZoneDto) {
  return {
    rateCardId,
    destination: z.destination.replace(/\s+/g, '').toUpperCase(),
    zone: z.zone,
  };
}

/**
 * Tier soundness, checked once at activation.
 *
 * Tiers are grouped by (itemCode, zone, tierBasis) — bands only compete with the
 * bands they share an axis with. Within a group the bands must form a single
 * continuous run: start at 0, no gaps, no overlaps. Both failures are silent and
 * expensive in production — a gap throws at billing time for one unlucky parcel,
 * an overlap bills two different prices for the same weight depending on row order.
 */
function assertTiersAreSound(items: Array<{
  itemCode: string | null; zone: string | null; tierBasis: string;
  rangeStart: any; rangeEnd: any;
}>) {
  const groups = new Map<string, typeof items>();
  for (const i of items) {
    if (i.tierBasis === 'NONE') continue;
    const key = `${i.itemCode ?? ''}|${i.zone ?? ''}|${i.tierBasis}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(i);
  }

  for (const [key, group] of groups) {
    const label = key.split('|').filter(Boolean).join(' / ');
    const bands = [...group].sort((a, b) => lo(a.rangeStart) - lo(b.rangeStart));

    for (const b of bands) {
      if (hi(b.rangeEnd) <= lo(b.rangeStart)) {
        throw new BadRequestException(
          `[${label}] 梯度区间无效：起点 ${lo(b.rangeStart)} 不小于终点 ${hi(b.rangeEnd)}`,
        );
      }
    }

    if (lo(bands[0].rangeStart) !== 0) {
      throw new BadRequestException(
        `[${label}] 梯度未从 0 开始，最低一档起点为 ${lo(bands[0].rangeStart)}`,
      );
    }

    for (let n = 1; n < bands.length; n++) {
      const prevEnd = hi(bands[n - 1].rangeEnd);
      const start = lo(bands[n].rangeStart);
      if (start < prevEnd) {
        throw new BadRequestException(
          `[${label}] 梯度区间重叠：${start} 落在上一档 [${lo(bands[n - 1].rangeStart)}, ${prevEnd}) 内`,
        );
      }
      if (start > prevEnd) {
        throw new BadRequestException(
          `[${label}] 梯度区间不连续：${prevEnd} 到 ${start} 之间没有对应价格`,
        );
      }
    }

    if (hi(bands[bands.length - 1].rangeEnd) !== Infinity) {
      throw new BadRequestException(
        `[${label}] 最高一档必须开口（rangeEnd 留空），否则超出 ` +
        `${hi(bands[bands.length - 1].rangeEnd)} 的业务无价可计`,
      );
    }
  }
}
