import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OutboundOrderStatus } from '@prisma/client';
import { assertTransition, OUTBOUND_TRANSITIONS } from '../common/state-machine';
import { OperationLogService } from '../common/operation-log.service';
import { InventoryTransactionService } from '../common/inventory-transaction.service';
import { dailyPrefix, nextDocNo, isUniqueViolation } from '../common/doc-no';
import { CreateOutboundOrderDto } from './dto/create-outbound-order.dto';

@Injectable()
export class OutboundOrdersService {
  constructor(
    private prisma: PrismaService,
    private opLog: OperationLogService,
    private invTx: InventoryTransactionService,
  ) {}

  // ─── List ───────────────────────────────────────────────────────────

  async list(query: { page?: number; pageSize?: number; status?: string; channel?: string }) {
    const page = Number(query.page ?? 1);
    const pageSize = Number(query.pageSize ?? 20);

    const where: any = {};
    if (query.status) {
      where.status = query.status as OutboundOrderStatus;
    }

    const [rows, total] = await Promise.all([
      this.prisma.outboundOrder.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          customer: true,
          items: { include: { product: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.outboundOrder.count({ where }),
    ]);

    const data = rows.map((order) => {
      const totalItems = order.items.reduce((s, i) => s + i.requiredQty, 0);
      const { items, customer, ...rest } = order;
      return {
        ...rest,
        customerName: customer?.name || 'Unknown',
        totalItems,
        items: items.map((item) => ({
          sku: item.product?.sku,
          productName: item.product?.name,
          requiredQty: item.requiredQty,
          pickedQty: item.pickedQty,
          packedQty: item.packedQty,
        })),
      };
    });

    return { data, pagination: { page, pageSize, total } };
  }

  // ─── Create (建单) ──────────────────────────────────────────────────

  async create(body: CreateOutboundOrderDto) {
    const { items, ...fields } = body;

    // Validate relations up front → clean 4xx instead of a raw Prisma FK violation.
    const [customer, warehouse] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: fields.customerId } }),
      this.prisma.warehouse.findUnique({ where: { id: fields.warehouseId } }),
    ]);
    if (!customer) throw new NotFoundException('客户不存在');
    if (!warehouse) throw new NotFoundException('仓库不存在');

    const productIds = [...new Set(items.map((i) => i.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true },
    });
    if (products.length !== productIds.length) {
      const found = new Set(products.map((p) => p.id));
      const missing = productIds.filter((id) => !found.has(id));
      throw new BadRequestException(`商品不存在: ${missing.join(', ')}`);
    }

    // Per-day sequential orderNo (OB-YYMMDD-NNNN) derived from the highest existing
    // number for today's prefix — delete-safe, unlike the old count()+1. The bounded
    // retry covers the rare concurrent clash on the orderNo unique constraint.
    const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    const prefix = `OB-${datePart}-`;
    const MAX_TRIES = 5;

    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      const last = await this.prisma.outboundOrder.findFirst({
        where: { orderNo: { startsWith: prefix } },
        orderBy: { orderNo: 'desc' },
        select: { orderNo: true },
      });
      const nextSeq = last ? Number(last.orderNo.slice(prefix.length)) + 1 : 1;
      const orderNo = `${prefix}${String(nextSeq).padStart(4, '0')}`;

      try {
        const order = await this.prisma.outboundOrder.create({
          data: {
            orderNo,
            ...fields, // customerId, warehouseId + whitelisted fulfillment scalars
            status: 'PENDING',
            items: {
              create: items.map((i) => ({ productId: i.productId, requiredQty: i.requiredQty })),
            },
          },
          include: { items: { include: { product: true } } },
        });

        await this.opLog.log({
          entityType: 'OUTBOUND_ORDER', entityId: order.id, action: 'CREATE',
          beforeData: {}, afterData: { orderNo, status: 'PENDING', itemCount: items.length },
          description: `出库单 ${orderNo} 创建`,
        });

        return order;
      } catch (e) {
        // Concurrent insert grabbed this number first → recompute and retry.
        if ((e as { code?: string }).code === 'P2002' && attempt < MAX_TRIES) continue;
        throw e;
      }
    }

    // All retries collided on the unique constraint (extremely unlikely).
    throw new BadRequestException('生成出库单号冲突，请重试');
  }

  // ─── Bulk create (JSON 批量导入) ────────────────────────────────────

  async bulkCreate(orders: CreateOutboundOrderDto[]) {
    let created = 0;
    const orderNos: string[] = [];
    const errors: string[] = [];

    // Sequential (not Promise.all): orderNo uses count()+1, which must see prior inserts.
    for (let i = 0; i < orders.length; i++) {
      try {
        const o = await this.create(orders[i]);
        created++;
        orderNos.push(o.orderNo);
      } catch (err: any) {
        const label = orders[i].customerRef ?? orders[i].recipientName ?? `#${i + 1}`;
        errors.push(`第 ${i + 1} 单 [${label}]: ${err.message}`);
      }
    }

    return { created, total: orders.length, orderNos, errors };
  }

  // ─── Detail ─────────────────────────────────────────────────────────

  async detail(id: string) {
    const order = await this.prisma.outboundOrder.findUnique({
      where: { id },
      include: {
        customer: true,
        warehouse: true,
        items: { include: { product: true } },
        exceptions: true,
      },
    });

    if (!order) throw new NotFoundException('出库单不存在');

    const { customer, warehouse, items, exceptions, ...fields } = order;
    return {
      ...fields, // all scalar columns, incl. the fulfillment fields
      customerName: customer?.name || 'Unknown',
      warehouseCode: warehouse?.code ?? null, // 海外仓代码 (derived, not stored)
      warehouseAddress: warehouse?.address ?? null, // 仓库地址 (derived)
      totalProductCount: items.reduce((s, i) => s + i.requiredQty, 0), // 产品总数 (derived)
      items: items.map((item) => ({
        sku: item.product?.sku,
        productName: item.product?.name,
        requiredQty: item.requiredQty,
        pickedQty: item.pickedQty,
        packedQty: item.packedQty,
      })),
      exceptions,
    };
  }

  // ─── Action: Allocate (库存分配, FIFO) ──────────────────────────────

  async allocate(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.outboundOrder.findUnique({
        where: { id },
        include: { items: { include: { product: true } } },
      });
      if (!order) throw new NotFoundException('出库单不存在');
      assertTransition(order.status, 'ALLOCATED', OUTBOUND_TRANSITIONS, '出库单');

      // Reserve stock for each line item, drawing from oldest inbound first (FIFO).
      for (const item of order.items) {
        let remaining = item.requiredQty;

        const candidates = await tx.inventory.findMany({
          where: {
            warehouseId: order.warehouseId,
            customerId: order.customerId,
            productId: item.productId,
            inventoryStatus: 'QUALIFIED',
            availableQty: { gt: 0 },
          },
          orderBy: [{ inboundDate: 'asc' }, { createdAt: 'asc' }],
        });

        for (const inv of candidates) {
          if (remaining <= 0) break;
          const take = Math.min(remaining, inv.availableQty);

          // available → frozen (totalQty unchanged: stock is reserved, not gone)
          await tx.inventory.update({
            where: { id: inv.id },
            data: {
              availableQty: inv.availableQty - take,
              frozenQty: inv.frozenQty + take,
            },
          });

          await tx.outboundAllocation.create({
            data: { outboundItemId: item.id, inventoryId: inv.id, qty: take },
          });

          await this.invTx.record(
            {
              warehouseId: order.warehouseId,
              customerId: order.customerId,
              productId: item.productId,
              locationId: inv.locationId,
              batchNo: inv.batchNo ?? undefined,
              type: 'FREEZE',
              qtyBefore: inv.availableQty,
              qtyChange: -take,
              qtyAfter: inv.availableQty - take,
              refType: 'OUTBOUND_ORDER',
              refId: order.id,
              refNo: order.orderNo,
              reason: `预留(available) 出库单 ${order.orderNo}`,
            },
            tx,
          );

          remaining -= take;
        }

        // Fail-fast: cannot fully reserve → roll back the whole transaction.
        if (remaining > 0) {
          const totalAvailable = candidates.reduce((s, c) => s + c.availableQty, 0);
          throw new BadRequestException(
            `SKU ${item.product.sku} 可用库存不足：需 ${item.requiredQty}，可用 ${totalAvailable}`,
          );
        }
      }

      const updated = await tx.outboundOrder.update({
        where: { id },
        data: { status: 'ALLOCATED' },
      });

      await this.opLog.log(
        {
          entityType: 'OUTBOUND_ORDER', entityId: id, action: 'ALLOCATE',
          beforeData: { status: order.status }, afterData: { status: 'ALLOCATED' },
          description: `出库单 ${order.orderNo} 库存分配完成 (FIFO)`,
        },
        tx,
      );

      return updated;
    });
  }

  // ─── Action: Start Picking (开始拣货) ───────────────────────────────

  async startPicking(id: string) {
    const order = await this.findOrThrow(id);
    assertTransition(order.status, 'PICKING', OUTBOUND_TRANSITIONS, '出库单');

    const updated = await this.prisma.outboundOrder.update({
      where: { id },
      data: { status: 'PICKING' },
    });

    await this.opLog.log({
      entityType: 'OUTBOUND_ORDER', entityId: id, action: 'START_PICKING',
      beforeData: { status: order.status }, afterData: { status: 'PICKING' },
      description: `出库单 ${order.orderNo} 开始拣货`,
    });

    return updated;
  }

  // ─── Action: Complete Picking (拣货完成) ────────────────────────────

  async completePicking(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.outboundOrder.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!order) throw new NotFoundException('出库单不存在');
      assertTransition(order.status, 'PICKED', OUTBOUND_TRANSITIONS, '出库单');

      // Verify all items have been picked
      const allPicked = order.items.every((i) => i.pickedQty >= i.requiredQty);
      if (!allPicked) {
        throw new BadRequestException('尚有未拣完的 SKU，无法完成拣货');
      }

      const updated = await tx.outboundOrder.update({
        where: { id },
        data: { status: 'PICKED' },
      });

      await this.opLog.log({
        entityType: 'OUTBOUND_ORDER', entityId: id, action: 'COMPLETE_PICKING',
        beforeData: { status: order.status }, afterData: { status: 'PICKED' },
        description: `出库单 ${order.orderNo} 拣货完成`,
      }, tx);

      return updated;
    });
  }

  // ─── Action: Start Packing (开始打包) ──────────────────────────────

  async startPacking(id: string) {
    const order = await this.findOrThrow(id);
    assertTransition(order.status, 'PACKING', OUTBOUND_TRANSITIONS, '出库单');

    const updated = await this.prisma.outboundOrder.update({
      where: { id },
      data: { status: 'PACKING' },
    });

    await this.opLog.log({
      entityType: 'OUTBOUND_ORDER', entityId: id, action: 'START_PACKING',
      beforeData: { status: order.status }, afterData: { status: 'PACKING' },
      description: `出库单 ${order.orderNo} 开始打包`,
    });

    return updated;
  }

  // ─── Action: Pack item (打包扫码) ──────────────────────────────────

  async pack(id: string, body: { sku: string; qty: number; boxNo?: string }) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.outboundOrder.findUnique({
        where: { id },
        include: { items: { include: { product: true } } },
      });

      if (!order) throw new NotFoundException('出库单不存在');

      // Must be in PACKING status
      if (order.status !== 'PACKING') {
        throw new BadRequestException(`当前状态 [${order.status}] 不允许打包操作，需先进入打包状态`);
      }

      const item = order.items.find((i) => i.product.sku === body.sku);
      if (!item) throw new NotFoundException('订单中不存在该 SKU');

      if (item.packedQty + Number(body.qty) > item.requiredQty) {
        throw new BadRequestException('打包数量超出需求数量');
      }

      const updatedItem = await tx.outboundItem.update({
        where: { id: item.id },
        data: { packedQty: item.packedQty + Number(body.qty) },
      });

      return {
        orderId: order.id,
        orderNo: order.orderNo,
        sku: body.sku,
        packedQty: updatedItem.packedQty,
        requiredQty: item.requiredQty,
        boxNo: body.boxNo ?? 'BOX-AUTO',
        status: order.status,
      };
    });
  }

  // ─── Action: Complete Packing (打包完成) ────────────────────────────

  async completePacking(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.outboundOrder.findUnique({
        where: { id },
        include: { items: true },
      });
      if (!order) throw new NotFoundException('出库单不存在');
      assertTransition(order.status, 'PACKED', OUTBOUND_TRANSITIONS, '出库单');

      const allPacked = order.items.every((i) => i.packedQty >= i.requiredQty);
      if (!allPacked) {
        throw new BadRequestException('尚有未打包完成的 SKU');
      }

      return tx.outboundOrder.update({
        where: { id },
        data: { status: 'PACKED' },
      });
    });
  }

  // ─── Action: Ship (签出发货) ────────────────────────────────────────

  async ship(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.outboundOrder.findUnique({
        where: { id },
        include: { items: { include: { allocations: true } } },
      });
      if (!order) throw new NotFoundException('出库单不存在');
      assertTransition(order.status, 'SHIPPED', OUTBOUND_TRANSITIONS, '出库单');

      // Reserved stock physically leaves: frozen → gone (frozenQty & totalQty both decrease).
      for (const item of order.items) {
        for (const alloc of item.allocations) {
          const inv = await tx.inventory.findUnique({ where: { id: alloc.inventoryId } });
          if (!inv) continue;

          await tx.inventory.update({
            where: { id: inv.id },
            data: {
              frozenQty: inv.frozenQty - alloc.qty,
              totalQty: inv.totalQty - alloc.qty,
            },
          });

          await this.invTx.record(
            {
              warehouseId: inv.warehouseId,
              customerId: inv.customerId,
              productId: inv.productId,
              locationId: inv.locationId,
              batchNo: inv.batchNo ?? undefined,
              type: 'OUTBOUND',
              qtyBefore: inv.totalQty,
              qtyChange: -alloc.qty,
              qtyAfter: inv.totalQty - alloc.qty,
              refType: 'OUTBOUND_ORDER',
              refId: order.id,
              refNo: order.orderNo,
              reason: `出库发货(total) 出库单 ${order.orderNo}`,
            },
            tx,
          );
        }
      }

      const updated = await tx.outboundOrder.update({
        where: { id },
        data: { status: 'SHIPPED' },
      });

      await this.opLog.log(
        {
          entityType: 'OUTBOUND_ORDER', entityId: id, action: 'SHIP',
          beforeData: { status: order.status }, afterData: { status: 'SHIPPED' },
          description: `出库单 ${order.orderNo} 签出发货`,
        },
        tx,
      );

      return updated;
    });
  }

  // ─── Action: Sign (物流确认) ────────────────────────────────────────

  async sign(id: string) {
    const order = await this.findOrThrow(id);
    assertTransition(order.status, 'SIGNED', OUTBOUND_TRANSITIONS, '出库单');

    const updated = await this.prisma.outboundOrder.update({
      where: { id },
      data: { status: 'SIGNED' },
    });

    await this.opLog.log({
      entityType: 'OUTBOUND_ORDER', entityId: id, action: 'SIGN',
      beforeData: { status: order.status }, afterData: { status: 'SIGNED' },
      description: `出库单 ${order.orderNo} 物流确认`,
    });

    return updated;
  }

  // ─── Action: Mark Exception ─────────────────────────────────────────

  async markException(id: string, body: { type: string; reason?: string }) {
    // exceptionNo is generated inside the transaction, so a unique-constraint clash
    // is only recoverable by re-running the whole transaction.
    const MAX_TRIES = 5;

    for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const order = await tx.outboundOrder.findUnique({ where: { id } });
          if (!order) throw new NotFoundException('出库单不存在');
          assertTransition(order.status, 'EXCEPTION', OUTBOUND_TRANSITIONS, '出库单');

          // Release any reservations back to available before parking the order.
          await this.releaseAllocations(tx, order);

          // Per-day sequential exceptionNo from the highest existing number for
          // today's prefix — delete-safe, unlike the old count()+1.
          const prefix = dailyPrefix('EX');
          const last = await tx.outboundException.findFirst({
            where: { exceptionNo: { startsWith: prefix } },
            orderBy: { exceptionNo: 'desc' },
            select: { exceptionNo: true },
          });
          const exceptionNo = nextDocNo(prefix, last?.exceptionNo ?? null);

          await tx.outboundException.create({
            data: {
              exceptionNo,
              outboundOrderId: id,
              type: body.type,
              reason: body.reason,
              status: 'OPEN',
            },
          });

          return tx.outboundOrder.update({
            where: { id },
            data: { status: 'EXCEPTION' },
          });
        });
      } catch (e) {
        if (isUniqueViolation(e) && attempt < MAX_TRIES) continue;
        throw e;
      }
    }

    throw new BadRequestException('生成异常单号冲突，请重试');
  }

  // ─── Action: Cancel (取消) ──────────────────────────────────────────

  async cancel(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.outboundOrder.findUnique({ where: { id } });
      if (!order) throw new NotFoundException('出库单不存在');
      assertTransition(order.status, 'CANCELLED', OUTBOUND_TRANSITIONS, '出库单');

      // Release any reservations back to available stock.
      await this.releaseAllocations(tx, order);

      const updated = await tx.outboundOrder.update({
        where: { id },
        data: { status: 'CANCELLED' },
      });

      await this.opLog.log(
        {
          entityType: 'OUTBOUND_ORDER', entityId: id, action: 'CANCEL',
          beforeData: { status: order.status }, afterData: { status: 'CANCELLED' },
          description: `出库单 ${order.orderNo} 已取消`,
        },
        tx,
      );

      return updated;
    });
  }

  // ─── Queries ────────────────────────────────────────────────────────

  async pickingLists() {
    const orders = await this.prisma.outboundOrder.findMany({
      where: { status: { in: ['ALLOCATED', 'WAVE_ASSIGNED', 'PICKING'] } },
      include: { customer: true, items: true },
      orderBy: { createdAt: 'desc' },
    });

    return orders.map((o) => ({
      id: `PL-${o.id}`,
      orderId: o.id,
      orderNo: o.orderNo,
      customerName: o.customer?.name || 'Unknown',
      status: o.status,
      lineCount: o.items.length,
      createdAt: o.createdAt,
    }));
  }

  async exceptions() {
    const exceptions = await this.prisma.outboundException.findMany({
      include: { outboundOrder: true },
      orderBy: { createdAt: 'desc' },
    });

    return exceptions.map((ex) => ({
      id: ex.id,
      exceptionNo: ex.exceptionNo,
      orderNo: ex.outboundOrder?.orderNo,
      type: ex.type,
      reason: ex.reason,
      status: ex.status,
      createdAt: ex.createdAt,
    }));
  }

  // ─── Helper ─────────────────────────────────────────────────────────

  /**
   * Return every reservation made for this order back to available stock and
   * delete its OutboundAllocation rows. Idempotent: orders with no allocations
   * (e.g. cancelled from PENDING, or already-released via EXCEPTION) are no-ops,
   * so EXCEPTION→PENDING re-allocation and EXCEPTION→CANCELLED never double-count.
   * Must run inside a transaction (tx).
   */
  private async releaseAllocations(
    tx: any,
    order: { id: string; orderNo: string },
  ) {
    const items = await tx.outboundItem.findMany({
      where: { outboundOrderId: order.id },
      include: { allocations: true },
    });

    for (const item of items) {
      for (const alloc of item.allocations) {
        const inv = await tx.inventory.findUnique({ where: { id: alloc.inventoryId } });
        if (inv) {
          // frozen → available (totalQty unchanged: stock never left the building)
          await tx.inventory.update({
            where: { id: inv.id },
            data: {
              frozenQty: inv.frozenQty - alloc.qty,
              availableQty: inv.availableQty + alloc.qty,
            },
          });

          await this.invTx.record(
            {
              warehouseId: inv.warehouseId,
              customerId: inv.customerId,
              productId: inv.productId,
              locationId: inv.locationId,
              batchNo: inv.batchNo ?? undefined,
              type: 'UNFREEZE',
              qtyBefore: inv.availableQty,
              qtyChange: alloc.qty,
              qtyAfter: inv.availableQty + alloc.qty,
              refType: 'OUTBOUND_ORDER',
              refId: order.id,
              refNo: order.orderNo,
              reason: `释放预留(available) 出库单 ${order.orderNo}`,
            },
            tx,
          );
        }

        await tx.outboundAllocation.delete({ where: { id: alloc.id } });
      }
    }
  }

  private async findOrThrow(id: string) {
    const order = await this.prisma.outboundOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('出库单不存在');
    return order;
  }
}