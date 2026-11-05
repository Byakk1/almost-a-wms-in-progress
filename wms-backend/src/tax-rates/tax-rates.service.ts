import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OperationLogService } from '../common/operation-log.service';
import { isUniqueViolation } from '../common/doc-no';
import { CreateTaxRateDto, ListTaxRatesQueryDto, UpdateTaxRateDto } from './dto/tax-rate.dto';

const ENTITY = 'TaxRate';

/** Parse an ISO date string to a Date; callers validate the format first. */
const dt = (s: string): Date => new Date(s);

/** The identity half of a TaxRate — the fields that may never be edited in place. */
const identityOf = (r: { countryCode: string; jurisdiction: string; taxType: string }) =>
  `${r.countryCode}/${r.jurisdiction}/${r.taxType}`;

/**
 * Windows are HALF-OPEN: [effectiveFrom, effectiveTo) — effectiveTo is the first
 * instant the row NO LONGER applies. Two windows collide only when their interiors
 * overlap, so a successor may start exactly when its predecessor ends
 * (old.effectiveTo == new.effectiveFrom): the zero-gap rotation the NS 15→14 %
 * seed relies on, and what makes the period-end lookup in bills.service.ts
 * seamless. A null end date means "still in force" and extends to +∞.
 *
 * (Before E4 verification this treated touching windows as a collision, which
 * forced a one-day gap between a rate and its successor — the same boundary bug,
 * found by the adversarial tax audit as a month with NO applicable rate.)
 */
function windowsIntersect(
  aFrom: Date, aTo: Date | null,
  bFrom: Date, bTo: Date | null,
): boolean {
  const aEnd = aTo ? aTo.getTime() : Infinity;
  const bEnd = bTo ? bTo.getTime() : Infinity;
  return aFrom.getTime() < bEnd && bFrom.getTime() < aEnd;
}

@Injectable()
export class TaxRatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: OperationLogService,
  ) {}

  // ─── Read ───────────────────────────────────────────────────────────

  async list(q: ListTaxRatesQueryDto) {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 20));

    const where: Prisma.TaxRateWhereInput = {};
    if (q.countryCode) where.countryCode = q.countryCode;
    if (q.jurisdiction) where.jurisdiction = q.jurisdiction;
    if (q.taxType) where.taxType = q.taxType;
    if (q.isActive !== undefined) where.isActive = q.isActive === 'true';

    const [data, total] = await this.prisma.$transaction([
      this.prisma.taxRate.findMany({
        where,
        // Filing order: country → province → tax type → oldest effective first, so a
        // rate's history reads top-to-bottom.
        orderBy: [
          { countryCode: 'asc' },
          { jurisdiction: 'asc' },
          { taxType: 'asc' },
          { effectiveFrom: 'asc' },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.taxRate.count({ where }),
    ]);

    return { data, pagination: { page, total, pageSize } };
  }

  async create(dto: CreateTaxRateDto) {
    const effectiveFrom = dt(dto.effectiveFrom);
    const effectiveTo = dto.effectiveTo ? dt(dto.effectiveTo) : null;
    this.assertWindow(effectiveFrom, effectiveTo);

    await this.assertNoOverlap(
      { countryCode: dto.countryCode, jurisdiction: dto.jurisdiction, taxType: dto.taxType },
      effectiveFrom,
      effectiveTo,
      null,
    );

    let row;
    try {
      row = await this.prisma.taxRate.create({
        data: {
          countryCode: dto.countryCode,
          jurisdiction: dto.jurisdiction,
          taxType: dto.taxType,
          ratePercent: dto.ratePercent,
          effectiveFrom,
          effectiveTo,
          note: dto.note ?? null,
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException(
          `该生效日期已存在同税种记录：${identityOf(dto)} @ ${dto.effectiveFrom}（请改用其他生效日期或修改原记录）`,
        );
      }
      throw e;
    }

    await this.audit.log({
      entityType: ENTITY,
      entityId: row.id,
      action: 'CREATE',
      afterData: row,
      description: `新增税率 ${identityOf(row)} ${row.ratePercent}%（生效 ${dto.effectiveFrom}）`,
    });
    return row;
  }

  async update(id: string, dto: UpdateTaxRateDto) {
    const before = await this.getOrThrow(id);

    const effectiveTo =
      dto.effectiveTo === undefined
        ? before.effectiveTo
        : dto.effectiveTo === null
          ? null
          : dt(dto.effectiveTo);
    this.assertWindow(before.effectiveFrom, effectiveTo);

    // Only an ACTIVE row can collide with another active row; a row being switched
    // off may end up sharing a window with whatever replaced it.
    const willBeActive = dto.isActive ?? before.isActive;
    if (willBeActive) {
      await this.assertNoOverlap(
        { countryCode: before.countryCode, jurisdiction: before.jurisdiction, taxType: before.taxType },
        before.effectiveFrom,
        effectiveTo,
        id,
      );
    }

    let after;
    try {
      after = await this.prisma.taxRate.update({
        where: { id },
        data: {
          ...(dto.ratePercent !== undefined ? { ratePercent: dto.ratePercent } : {}),
          ...(dto.effectiveTo !== undefined ? { effectiveTo } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          ...(dto.note !== undefined ? { note: dto.note } : {}),
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException(`该生效日期已存在同税种记录：${identityOf(before)} @ ${before.effectiveFrom}`);
      }
      throw e;
    }

    await this.audit.log({
      entityType: ENTITY,
      entityId: id,
      action: 'UPDATE',
      beforeData: before,
      afterData: after,
      description: `更新税率 ${identityOf(after)}（${before.ratePercent}% → ${after.ratePercent}%）`,
    });
    return after;
  }

  // ─── helpers ─────────────────────────────────────────────────────────

  private async getOrThrow(id: string) {
    const row = await this.prisma.taxRate.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('税率记录不存在');
    return row;
  }

  /** The end of a rate's life must be strictly after its start. */
  private assertWindow(from: Date, to: Date | null) {
    if (to && to.getTime() <= from.getTime()) {
      throw new BadRequestException('失效日期必须晚于生效日期（effectiveTo 需大于 effectiveFrom）');
    }
  }

  /**
   * Refuse a window that intersects another ACTIVE row with the same identity.
   * The DB unique index only guards the start date, so without this check two windows
   * [Jan, Jun] and [Mar, Sep] would both be "active" and billing would not know which
   * rate applies in March. Mirrors the rate-card tier-overlap guard.
   */
  private async assertNoOverlap(
    identity: { countryCode: string; jurisdiction: string; taxType: string },
    effectiveFrom: Date,
    effectiveTo: Date | null,
    excludeId: string | null,
  ) {
    const candidates = await this.prisma.taxRate.findMany({
      where: {
        ...identity,
        isActive: true,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      select: { id: true, effectiveFrom: true, effectiveTo: true },
    });

    const clash = candidates.find((c) =>
      windowsIntersect(effectiveFrom, effectiveTo, c.effectiveFrom, c.effectiveTo),
    );
    if (clash) {
      throw new BadRequestException(
        `税率生效区间与已有记录重叠（记录 ${clash.id}：` +
          `${clash.effectiveFrom.toISOString().slice(0, 10)} ~ ` +
          `${clash.effectiveTo ? clash.effectiveTo.toISOString().slice(0, 10) : '至今'}）。` +
          `同一辖区同一税种的生效区间不得重叠——` +
          `调整税率请先为旧记录设置失效日期，再新增一条更晚生效的记录。`,
      );
    }
  }
}
