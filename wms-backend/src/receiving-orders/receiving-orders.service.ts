import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReceivingOrderStatus } from '@prisma/client';
import { assertTransition, RECEIVING_TRANSITIONS } from '../common/state-machine';
import { OperationLogService } from '../common/operation-log.service';
import { dailyPrefix, nextDocNo, isUniqueViolation } from '../common/doc-no';

interface ListReceivingQuery {
  page?: number;
  pageSize?: number;
  status?: ReceivingOrderStatus;
  customerName?: string;
}

@Injectable()
export class ReceivingOrdersService {
  constructor(
    private prisma: PrismaService,
    private opLog: OperationLogService,
  ) {}

  // ─── List ───────────────────────────────────────────────────────────

  async list(query: ListReceivingQuery) {
    const page = Number(query.page ?? 1);
    const pageSize = Number(query.pageSize ?? 20);

    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.customerName) {
      where.customer = { name: { contains: query.customerName, mode: 'insensitive' } };
    }

    const [rows, total] = await Promise.all([
      this.prisma.receivingOrder.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { customer: true, items: { include: { product: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.receivingOrder.count({ where }),
    ]);

    const data = rows.map((r) => ({
      id: r.id,
      receivingNo: r.receivingNo,
      customerName: r.customer?.name ?? 'Unknown',
      trackingNo: r.trackingNo,
      expectedQuantity: r.expectedQuantity,
      actualQuantity: r.actualQuantity,
      status: r.status,
      operatorId: r.operatorId,
      remark: r.remark,
      createdAt: r.createdAt,
      itemCount: r.items.length,
    }));

    return { data, pagination: { page, pageSize, total } };
  }

  // ─── Create ─────────────────────────────────────────────────────────

  async create(body: {
    customerId: string;
    warehouseId: string;
    trackingNo?: string;
    expectedQuantity: number;
    items?: Array<{ productId: string; expectedQty: number }>;
  }) {
    // Per-day sequential receivingNo derived from the highest existing number for
    // today's prefix — delete-safe, unlike the old count()+1. The bounded retry
    // covers a concurrent clash on the receivingNo unique constraint.
    const prefix = dailyPrefix('IN');
    const MAX_TRIES = 5;

    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      const last = await this.prisma.receivingOrder.findFirst({
        where: { receivingNo: { startsWith: prefix } },
        orderBy: { receivingNo: 'desc' },
        select: { receivingNo: true },
      });
      const receivingNo = nextDocNo(prefix, last?.receivingNo ?? null);

      try {
        return await this.prisma.receivingOrder.create({
          data: {
            receivingNo,
            customerId: body.customerId,
            warehouseId: body.warehouseId,
            trackingNo: body.trackingNo,
            expectedQuantity: body.expectedQuantity,
            status: 'PENDING',
            items: body.items
              ? {
                  create: body.items.map((i) => ({
                    productId: i.productId,
                    expectedQty: i.expectedQty,
                  })),
                }
              : undefined,
          },
          include: { items: true },
        });
      } catch (e) {
        if (isUniqueViolation(e) && attempt < MAX_TRIES) continue;
        throw e;
      }
    }

    throw new BadRequestException('生成收货单号冲突，请重试');
  }

  // ─── Detail ─────────────────────────────────────────────────────────

  async detail(id: string) {
    const order = await this.prisma.receivingOrder.findUnique({
      where: { id },
      include: {
        customer: true,
        items: { include: { product: true } },
        putawayTasks: true,
      },
    });
    if (!order) throw new NotFoundException('收货单不存在');
    return order;
  }

  // ─── Action: Arrive (到仓) ──────────────────────────────────────────

  async arrive(id: string) {
    const order = await this.findOrThrow(id);
    assertTransition(order.status, 'ARRIVED', RECEIVING_TRANSITIONS, '收货单');

    const updated = await this.prisma.receivingOrder.update({
      where: { id },
      data: { status: 'ARRIVED' },
    });

    await this.opLog.log({
      entityType: 'RECEIVING_ORDER', entityId: id, action: 'ARRIVE',
      beforeData: { status: order.status }, afterData: { status: 'ARRIVED' },
      description: `收货单 ${order.receivingNo} 到仓`,
    });

    return updated;
  }

  // ─── Action: Start Checking (开始验收) ──────────────────────────────

  async startChecking(id: string) {
    const order = await this.findOrThrow(id);
    assertTransition(order.status, 'CHECKING', RECEIVING_TRANSITIONS, '收货单');

    const updated = await this.prisma.receivingOrder.update({
      where: { id },
      data: { status: 'CHECKING' },
    });

    await this.opLog.log({
      entityType: 'RECEIVING_ORDER', entityId: id, action: 'CHECK',
      beforeData: { status: order.status }, afterData: { status: 'CHECKING' },
      description: `收货单 ${order.receivingNo} 开始验收`,
    });

    return updated;
  }

  // ─── Action: Receive / Scan (扫码收货) ──────────────────────────────

  async receive(id: string, body: { sku: string; qty: number; locationId?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.receivingOrder.findUnique({
        where: { id },
        include: { items: { include: { product: true } } },
      });
      if (!order) throw new NotFoundException('收货单不存在');

      // Must be in CHECKING or RECEIVING to scan
      if (order.status !== 'CHECKING' && order.status !== 'RECEIVING') {
        throw new BadRequestException(
          `当前状态 [${order.status}] 不允许扫码收货，需先验收`,
        );
      }

      // Find matching item by SKU
      const item = order.items.find((i) => i.product.sku === body.sku);
      if (!item) throw new NotFoundException(`订单中不存在 SKU: ${body.sku}`);

      const newReceivedQty = item.receivedQty + Number(body.qty);
      if (newReceivedQty > item.expectedQty) {
        throw new BadRequestException(
          `收货数量超出预期：已收 ${item.receivedQty}，本次 ${body.qty}，预期 ${item.expectedQty}`,
        );
      }

      // Update item
      await tx.receivingItem.update({
        where: { id: item.id },
        data: { receivedQty: newReceivedQty },
      });

      // Update order totals and status → RECEIVING
      const newActualQty = order.actualQuantity + Number(body.qty);
      await tx.receivingOrder.update({
        where: { id },
        data: {
          actualQuantity: newActualQty,
          status: 'RECEIVING',
        },
      });

      // Audit log
      await this.opLog.log({
        entityType: 'RECEIVING_ORDER', entityId: id, action: 'RECEIVE',
        beforeData: { actualQuantity: order.actualQuantity, status: order.status },
        afterData: { actualQuantity: newActualQty, status: 'RECEIVING' },
        description: `收货单 ${order.receivingNo} 扫码收货 SKU:${body.sku} x${body.qty}`,
      }, tx);

      return {
        receivingNo: order.receivingNo,
        scannedSku: body.sku,
        scannedQty: body.qty,
        newReceivedQty,
        orderActualQty: newActualQty,
        locationId: body.locationId,
      };
    });
  }

  // ─── Action: Complete (完成收货) ────────────────────────────────────

  async complete(id: string) {
    // taskNo is generated inside the transaction, so a unique-constraint clash can
    // only be recovered by re-running the whole transaction — a retry *inside* it
    // would hit an already-aborted transaction. Same shape as BoxesService.create.
    const MAX_TRIES = 5;

    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const order = await tx.receivingOrder.findUnique({
            where: { id },
            include: { items: { include: { product: true } } },
          });
          if (!order) throw new NotFoundException('收货单不存在');
          assertTransition(order.status, 'COMPLETED', RECEIVING_TRANSITIONS, '收货单');

          // Update order status
          await tx.receivingOrder.update({
            where: { id },
            data: { status: 'COMPLETED' },
          });

          // Per-day sequential taskNo from the highest existing number for today's
          // prefix (delete-safe), read once and then advanced per task.
          const prefix = dailyPrefix('PT');
          const lastTask = await tx.putawayTask.findFirst({
            where: { taskNo: { startsWith: prefix } },
            orderBy: { taskNo: 'desc' },
            select: { taskNo: true },
          });
          let lastNo = lastTask?.taskNo ?? null;

          // Auto-generate putaway tasks for each received item
          const putawayTasks: any[] = [];
          for (const item of order.items) {
            if (item.receivedQty > 0) {
              const taskNo = nextDocNo(prefix, lastNo, 3);
              lastNo = taskNo;

              const task = await tx.putawayTask.create({
                data: {
                  taskNo,
                  receivingOrderId: order.id,
                  productId: item.productId,
                  warehouseId: order.warehouseId,
                  qty: item.receivedQty,
                  status: 'PENDING',
                },
              });
              putawayTasks.push(task);
            }
          }

          // Move to PUTAWAY_PENDING
          const updatedOrder = await tx.receivingOrder.update({
            where: { id },
            data: { status: 'PUTAWAY_PENDING' },
          });

          // Audit log
          await this.opLog.log({
            entityType: 'RECEIVING_ORDER', entityId: id, action: 'COMPLETE',
            beforeData: { status: order.status },
            afterData: { status: 'PUTAWAY_PENDING', putawayTaskCount: putawayTasks.length },
            description: `收货单 ${order.receivingNo} 完成收货，生成 ${putawayTasks.length} 个上架任务`,
          }, tx);

          return { receivingOrder: updatedOrder, createdPutawayTasks: putawayTasks };
        });
      } catch (e) {
        if (isUniqueViolation(e) && attempt < MAX_TRIES) continue;
        throw e;
      }
    }

    throw new BadRequestException('生成上架任务号冲突，请重试');
  }

  // ─── Action: Mark Exception (异常) ─────────────────────────────────

  async markException(id: string, body: { reason: string }) {
    const order = await this.findOrThrow(id);
    assertTransition(order.status, 'EXCEPTION', RECEIVING_TRANSITIONS, '收货单');

    const updated = await this.prisma.receivingOrder.update({
      where: { id },
      data: { status: 'EXCEPTION', remark: body.reason },
    });

    await this.opLog.log({
      entityType: 'RECEIVING_ORDER', entityId: id, action: 'EXCEPTION',
      beforeData: { status: order.status },
      afterData: { status: 'EXCEPTION', reason: body.reason },
      description: `收货单 ${order.receivingNo} 标记异常：${body.reason}`,
    });

    return updated;
  }

  // ─── Action: Close Exception (关闭异常) ─────────────────────────────

  async closeException(id: string) {
    const order = await this.findOrThrow(id);
    assertTransition(order.status, 'EXCEPTION_CLOSED', RECEIVING_TRANSITIONS, '收货单');

    const updated = await this.prisma.receivingOrder.update({
      where: { id },
      data: { status: 'EXCEPTION_CLOSED' },
    });

    await this.opLog.log({
      entityType: 'RECEIVING_ORDER', entityId: id, action: 'CLOSE_EXCEPTION',
      beforeData: { status: order.status },
      afterData: { status: 'EXCEPTION_CLOSED' },
      description: `收货单 ${order.receivingNo} 关闭异常`,
    });

    return updated;
  }

  // ─── Helper ─────────────────────────────────────────────────────────

  private async findOrThrow(id: string) {
    const order = await this.prisma.receivingOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('收货单不存在');
    return order;
  }
}