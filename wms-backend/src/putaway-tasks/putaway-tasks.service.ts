import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PutawayRulesService, Recommendation } from '../putaway-rules/putaway-rules.service';

interface ListPutawayQuery {
  page?: number;
  pageSize?: number;
  status?: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
}

@Injectable()
export class PutawayTasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly putawayRules: PutawayRulesService,
  ) {}

  async list(query: ListPutawayQuery) {
    const page = Number(query.page ?? 1);
    const pageSize = Number(query.pageSize ?? 20);

    const where = query.status ? { status: query.status } : {};

    const [rows, total] = await Promise.all([
      this.prisma.putawayTask.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          product: true,
          location: true,
          receivingOrder: { select: { receivingNo: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.putawayTask.count({ where }),
    ]);

    // Recommend an EMPTY location for PENDING tasks (additive, advisory — see
    // PutawayRulesService.recommendForTasks). Guarded so non-PENDING pages add 0 queries.
    const pendingRows = rows.filter((t) => t.status === 'PENDING');
    let recommendations = new Map<string, Recommendation>();
    if (pendingRows.length > 0) {
      const warehouseIds = [...new Set(pendingRows.map((t) => t.warehouseId))];
      const [rules, emptyLocations] = await Promise.all([
        this.prisma.putawayRule.findMany({
          where: { warehouseId: { in: warehouseIds }, isActive: true },
          orderBy: { priority: 'desc' },
        }),
        this.prisma.location.findMany({
          where: { warehouseId: { in: warehouseIds }, status: 'EMPTY' },
          orderBy: [{ zone: 'asc' }, { code: 'asc' }],
        }),
      ]);
      recommendations = this.putawayRules.recommendForTasks(
        pendingRows.map((t) => ({
          id: t.id,
          warehouseId: t.warehouseId,
          itemType: t.product?.itemType ?? null,
        })),
        rules,
        emptyLocations,
      );
    }

    const data = rows.map((t) => {
      const rec = recommendations.get(t.id);
      return {
        id: t.id,
        taskNo: t.taskNo,
        receivingNo: t.receivingOrder?.receivingNo,
        sku: t.product?.sku,
        productName: t.product?.name,
        qty: t.qty,
        locationId: t.locationId,
        locationCode: t.location?.code ?? null,
        recommendedLocationId: rec?.recommendedLocationId ?? null,
        recommendedLocationCode: rec?.recommendedLocationCode ?? null,
        status: t.status,
        createdAt: t.createdAt,
      };
    });

    return { data, pagination: { page, pageSize, total } };
  }

  async putaway(id: string, body: { locationId: string; qty: number }) {
    return this.prisma.$transaction(async (tx) => {
      const task = await tx.putawayTask.findUnique({
        where: { id },
        include: { product: true },
      });
      if (!task) throw new NotFoundException('上架任务不存在');
      if (task.status === 'COMPLETED') {
        throw new BadRequestException('该上架任务已完成，不可重复操作');
      }

      // Accept either id or code for locationId param (mock used to)
      const location = await tx.location.findFirst({
        where: { OR: [{ id: body.locationId }, { code: body.locationId }] },
      });
      if (!location) throw new NotFoundException('库位不存在');
      if (location.warehouseId !== task.warehouseId) {
        throw new BadRequestException('库位与任务不属于同一仓库');
      }

      const qty = Number(body.qty);

      const updatedTask = await tx.putawayTask.update({
        where: { id },
        data: { locationId: location.id, qty, status: 'COMPLETED' },
      });

      await tx.location.update({
        where: { id: location.id },
        data: { status: 'OCCUPIED' },
      });

      const existing = await tx.inventory.findFirst({
        where: {
          warehouseId: task.warehouseId,
          productId: task.productId,
          locationId: location.id,
        },
      });

      if (existing) {
        await tx.inventory.update({
          where: { id: existing.id },
          data: {
            availableQty: existing.availableQty + qty,
            totalQty: existing.totalQty + qty,
          },
        });
      } else {
        const batchNo = `BATCH-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${task.id.slice(-4)}`;
        await tx.inventory.create({
          data: {
            warehouseId: task.warehouseId,
            customerId: task.product.customerId,
            productId: task.productId,
            locationId: location.id,
            batchNo,
            availableQty: qty,
            totalQty: qty,
            inboundDate: new Date(),
          },
        });
      }

      return updatedTask;
    });
  }
}
