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
import {
  CreateSurchargeDto, ListSurchargesQueryDto, UpdateSurchargeDto,
} from './dto/surcharge.dto';

const ENTITY = 'Surcharge';

/** PERCENT_OF_BASE ceiling — a 10× markup is already absurd; anything above is a typo. */
const MAX_PERCENT = 1000;

/** Parse an ISO date string to a Date; callers validate the format first. */
const dt = (s: string): Date => new Date(s);

@Injectable()
export class SurchargesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: OperationLogService,
  ) {}

  // ─── Read ───────────────────────────────────────────────────────────

  async list(q: ListSurchargesQueryDto) {
    const page = Math.max(1, Number(q.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize) || 20));

    const where: Prisma.SurchargeWhereInput = {};
    if (q.code) where.code = q.code;
    if (q.calcType) where.calcType = q.calcType;
    if (q.carrier) where.carrier = q.carrier;
    if (q.isActive !== undefined) where.isActive = q.isActive === 'true';

    const [data, total] = await this.prisma.$transaction([
      this.prisma.surcharge.findMany({
        where,
        // `code` is unique, so ordering by it alone is total.
        orderBy: [{ code: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.surcharge.count({ where }),
    ]);

    return { data, pagination: { page, total, pageSize } };
  }

  // ─── Write ──────────────────────────────────────────────────────────

  async create(dto: CreateSurchargeDto) {
    const effectiveFrom = dt(dto.effectiveFrom);
    const effectiveTo = dto.effectiveTo ? dt(dto.effectiveTo) : null;
    this.assertWindow(effectiveFrom, effectiveTo);

    const value = dto.value ?? null;
    this.assertValueForType(dto.calcType, value);

    // No overlap guard here (unlike TaxRate): `code` is globally unique, so there can
    // never be two windows for the same surcharge — end-dating + a new code is the
    // supported way to change a surcharge's nature.
    let row;
    try {
      row = await this.prisma.surcharge.create({
        data: {
          code: dto.code,
          name: dto.name,
          calcType: dto.calcType,
          value,
          taxable: dto.taxable ?? true,
          carrier: dto.carrier ?? null,
          appliesTo: dto.appliesTo ?? 'ALL',
          note: dto.note ?? null,
          effectiveFrom,
          effectiveTo,
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException(`附加费代码已存在：${dto.code}（请改用其他代码或修改原记录）`);
      }
      throw e;
    }

    await this.audit.log({
      entityType: ENTITY,
      entityId: row.id,
      action: 'CREATE',
      afterData: row,
      description: `新增附加费 ${row.code} ${row.name}（${row.calcType}${value !== null ? ` ${value}` : ''}，生效 ${dto.effectiveFrom}）`,
    });
    return row;
  }

  async update(id: string, dto: UpdateSurchargeDto) {
    const before = await this.getOrThrow(id);

    const effectiveTo =
      dto.effectiveTo === undefined
        ? before.effectiveTo
        : dto.effectiveTo === null
          ? null
          : dt(dto.effectiveTo);
    this.assertWindow(before.effectiveFrom, effectiveTo);

    // calcType is immutable, so the value rule is checked against the stored type:
    // a FLAT row cannot lose its amount, a PASS_THROUGH row cannot gain one.
    const value =
      dto.value === undefined
        ? before.value === null ? null : Number(before.value)
        : dto.value;
    this.assertValueForType(before.calcType, value);

    let after;
    try {
      after = await this.prisma.surcharge.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.value !== undefined ? { value: dto.value } : {}),
          ...(dto.taxable !== undefined ? { taxable: dto.taxable } : {}),
          ...(dto.carrier !== undefined ? { carrier: dto.carrier } : {}),
          ...(dto.appliesTo !== undefined ? { appliesTo: dto.appliesTo } : {}),
          ...(dto.note !== undefined ? { note: dto.note } : {}),
          ...(dto.effectiveTo !== undefined ? { effectiveTo } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
    } catch (e) {
      if (isUniqueViolation(e)) {
        throw new ConflictException(`附加费代码已存在：${before.code}`);
      }
      throw e;
    }

    await this.audit.log({
      entityType: ENTITY,
      entityId: id,
      action: 'UPDATE',
      beforeData: before,
      afterData: after,
      description: `更新附加费 ${after.code}（${before.name} → ${after.name}，value ${before.value ?? '—'} → ${after.value ?? '—'}）`,
    });
    return after;
  }

  // ─── helpers ─────────────────────────────────────────────────────────

  private async getOrThrow(id: string) {
    const row = await this.prisma.surcharge.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('附加费记录不存在');
    return row;
  }

  /** The end of a surcharge's life must be strictly after its start. */
  private assertWindow(from: Date, to: Date | null) {
    if (to && to.getTime() <= from.getTime()) {
      throw new BadRequestException('失效日期必须晚于生效日期（effectiveTo 需大于 effectiveFrom）');
    }
  }

  /**
   * The value column means something different per calcType, so its presence is a
   * type rule, not a column rule:
   *   FLAT / PERCENT_OF_BASE  → value required (and a percent is capped at MAX_PERCENT)
   *   PASS_THROUGH            → value forbidden; the amount arrives at finalize
   */
  private assertValueForType(calcType: string, value: number | null) {
    switch (calcType) {
      case 'FLAT':
      case 'PERCENT_OF_BASE':
        if (value === null || value === undefined) {
          throw new BadRequestException(`该类型必须填写金额/比例（${calcType} 需提供 value）`);
        }
        if (calcType === 'PERCENT_OF_BASE' && value > MAX_PERCENT) {
          throw new BadRequestException(`比例不能超过 ${MAX_PERCENT}%（PERCENT_OF_BASE value）`);
        }
        return;
      case 'PASS_THROUGH':
        if (value !== null && value !== undefined) {
          throw new BadRequestException('实报实销不设固定值（PASS_THROUGH 的 value 必须为空，金额在结算时录入）');
        }
        return;
      default:
        throw new BadRequestException(`未知的计算方式：${calcType}（calcType）`);
    }
  }
}
