import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assertTransition, BOX_TRANSITIONS } from '../common/state-machine';
import { OperationLogService } from '../common/operation-log.service';
import { CreateBoxDto } from './dto/create-box.dto';
import { MeasureBoxDto } from './dto/measure-box.dto';
import { SignOutBoxesDto } from './dto/sign-out-boxes.dto';

/**
 * Volumetric divisor for cm³ → kg. Matches the `model Box` schema comment and the
 * existing air-freight estimate in FeeService, so the carton's chargeable weight and
 * the quoted fee cannot drift apart.
 */
const VOL_DIVISOR = 5000;

/** Weights are stored as Float but quoted to the gram — round to kill FP dust. */
const round3 = (n: number) => Math.round(n * 1000) / 1000;

const withOrder = {
  transitOrder: { include: { customer: true } },
} as const;

@Injectable()
export class BoxesService {
  constructor(
    private prisma: PrismaService,
    private opLog: OperationLogService,
  ) {}

  /** Flatten the joined transit order into the two fields the workbench UIs show. */
  private toView(box: any) {
    const { transitOrder, ...rest } = box;
    return {
      ...rest,
      orderNo: transitOrder?.orderNo ?? null,
      customerName: transitOrder?.customer?.name ?? null,
    };
  }

  // ─── List ───────────────────────────────────────────────────────────

  async list(query: {
    page?: number;
    pageSize?: number;
    status?: string;
    boxNo?: string;
    transitOrderId?: string;
  }) {
    const page = Number(query.page ?? 1);
    const pageSize = Number(query.pageSize ?? 20);

    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.boxNo) where.boxNo = query.boxNo;
    if (query.transitOrderId) where.transitOrderId = query.transitOrderId;

    const [rows, total] = await Promise.all([
      this.prisma.box.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: withOrder,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.box.count({ where }),
    ]);

    return { data: rows.map((r) => this.toView(r)), pagination: { page, pageSize, total } };
  }

  // ─── Create (打包建箱) ───────────────────────────────────────────────

  async create(dto: CreateBoxDto) {
    const count = dto.count ?? 1;

    const order = await this.prisma.transitOrder.findUnique({
      where: { id: dto.transitOrderId },
      include: { customer: true },
    });
    if (!order) throw new NotFoundException('中转单不存在');

    // Per-day sequential boxNo (BOX-YYMMDD-NNNN) from the highest existing number for
    // today's prefix — delete-safe, matching how OutboundOrdersService derives orderNo.
    // The bounded retry covers a concurrent clash on the boxNo unique constraint.
    const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    const prefix = `BOX-${datePart}-`;
    const MAX_TRIES = 5;

    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      const last = await this.prisma.box.findFirst({
        where: { boxNo: { startsWith: prefix } },
        orderBy: { boxNo: 'desc' },
        select: { boxNo: true },
      });
      const startSeq = last ? Number(last.boxNo.slice(prefix.length)) + 1 : 1;

      try {
        return await this.prisma.$transaction(async (tx) => {
          const created: any[] = [];

          for (let i = 0; i < count; i++) {
            const boxNo = `${prefix}${String(startSeq + i).padStart(4, '0')}`;
            const box = await tx.box.create({
              data: {
                boxNo,
                transitOrderId: dto.transitOrderId,
                pieces: dto.pieces ?? 0,
                destination: dto.destination ?? null,
                courier: dto.courier ?? null,
                status: 'PENDING',
              },
            });

            await this.opLog.log(
              {
                entityType: 'BOX', entityId: box.id, action: 'CREATE',
                beforeData: {}, afterData: { boxNo, status: 'PENDING' },
                description: `箱子 ${boxNo} 创建于中转单 ${order.orderNo}`,
              },
              tx,
            );

            created.push({ ...box, transitOrder: order });
          }

          return created.map((b) => this.toView(b));
        });
      } catch (e) {
        // Concurrent insert grabbed this number first → recompute and retry.
        if ((e as { code?: string }).code === 'P2002' && attempt < MAX_TRIES) continue;
        throw e;
      }
    }

    throw new BadRequestException('生成箱号冲突，请重试');
  }

  // ─── Measure (箱子测量：PENDING → MEASURED) ─────────────────────────

  async measure(boxNo: string, dto: MeasureBoxDto) {
    return this.prisma.$transaction(async (tx) => {
      const box = await tx.box.findUnique({ where: { boxNo }, include: withOrder });
      if (!box) throw new NotFoundException(`箱号不存在: ${boxNo}`);

      assertTransition(box.status, 'MEASURED', BOX_TRANSITIONS, `箱子 ${boxNo} 的`);

      // Chargeable weight is the greater of volumetric and actual — the carrier bills
      // whichever is larger. Derived here, never taken from the client.
      const volWeight = round3((dto.length * dto.width * dto.height) / VOL_DIVISOR);
      const chargeWeight = round3(Math.max(volWeight, dto.actualWeight));

      const updated = await tx.box.update({
        where: { boxNo },
        data: {
          length: dto.length,
          width: dto.width,
          height: dto.height,
          actualWeight: dto.actualWeight,
          volWeight,
          chargeWeight,
          status: 'MEASURED',
          measuredAt: new Date(),
        },
        include: withOrder,
      });

      await this.opLog.log(
        {
          entityType: 'BOX', entityId: box.id, action: 'MEASURE',
          beforeData: { status: box.status },
          afterData: {
            status: 'MEASURED',
            size: `${dto.length}x${dto.width}x${dto.height}`,
            actualWeight: dto.actualWeight, volWeight, chargeWeight,
          },
          description: `箱子 ${boxNo} 测量完成，计费重 ${chargeWeight} kg`,
        },
        tx,
      );

      return this.toView(updated);
    });
  }

  // ─── Sign out (按单签出：MEASURED → SIGNED_OUT) ─────────────────────

  async signOut(dto: SignOutBoxesDto) {
    const boxNos = [...new Set(dto.boxNos)];

    return this.prisma.$transaction(async (tx) => {
      const boxes = await tx.box.findMany({
        where: { boxNo: { in: boxNos } },
        include: withOrder,
      });

      if (boxes.length !== boxNos.length) {
        const found = new Set(boxes.map((b) => b.boxNo));
        const missing = boxNos.filter((n) => !found.has(n));
        throw new BadRequestException(`箱号不存在: ${missing.join(', ')}`);
      }

      // Validate the whole batch before writing anything — a partially signed-out
      // shipment is worse than a rejected one.
      for (const b of boxes) {
        assertTransition(b.status, 'SIGNED_OUT', BOX_TRANSITIONS, `箱子 ${b.boxNo} 的`);
      }

      const signedOutAt = new Date();
      const updated: any[] = [];

      for (const b of boxes) {
        const row = await tx.box.update({
          where: { boxNo: b.boxNo },
          data: {
            status: 'SIGNED_OUT',
            signedOutAt,
            trackingNo: dto.trackingNo,
            ...(dto.courier ? { courier: dto.courier } : {}),
          },
          include: withOrder,
        });

        await this.opLog.log(
          {
            entityType: 'BOX', entityId: b.id, action: 'SIGN_OUT',
            beforeData: { status: b.status },
            afterData: { status: 'SIGNED_OUT', trackingNo: dto.trackingNo, courier: dto.courier ?? b.courier },
            description: `箱子 ${b.boxNo} 签出，物流单号 ${dto.trackingNo}`,
          },
          tx,
        );

        updated.push(row);
      }

      return { count: updated.length, boxes: updated.map((b) => this.toView(b)) };
    });
  }
}
