import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { assertTransition, OUTBOUND_TRANSITIONS, WAVE_TRANSITIONS } from '../common/state-machine';
import { OperationLogService } from '../common/operation-log.service';
import { CreateWaveDto } from './dto/create-wave.dto';

const ACTIVE_WAVE_STATUSES = ['PENDING', 'RELEASED'];
const PICKED_OR_BEYOND = ['PICKED', 'PACKING', 'PACKED', 'SHIPPED', 'SIGNED'];

@Injectable()
export class WavesService {
  constructor(
    private prisma: PrismaService,
    private opLog: OperationLogService,
  ) {}

  // ─── List ───────────────────────────────────────────────────────────

  async list(query: { page?: number; pageSize?: number; status?: string }) {
    const page = Number(query.page ?? 1);
    const pageSize = Number(query.pageSize ?? 20);

    const where: any = {};
    if (query.status) where.status = query.status;

    const [rows, total] = await Promise.all([
      this.prisma.wave.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.wave.count({ where }),
    ]);

    return { data: rows, pagination: { page, pageSize, total } };
  }

  // ─── Create (建波次：手动选 ALLOCATED 单) ──────────────────────────

  async create(dto: CreateWaveDto) {
    const orderIds = [...new Set(dto.orderIds)];

    return this.prisma.$transaction(async (tx) => {
      const warehouse = await tx.warehouse.findUnique({ where: { id: dto.warehouseId } });
      if (!warehouse) throw new NotFoundException('仓库不存在');

      const orders = await tx.outboundOrder.findMany({
        where: { id: { in: orderIds } },
        include: { waveOrders: { include: { wave: true } } },
      });
      if (orders.length !== orderIds.length) {
        const found = new Set(orders.map((o) => o.id));
        const missing = orderIds.filter((id) => !found.has(id));
        throw new BadRequestException(`出库单不存在: ${missing.join(', ')}`);
      }

      // Pre-validate every order: same warehouse, ALLOCATED, not already in an active wave.
      for (const o of orders) {
        if (o.warehouseId !== dto.warehouseId) {
          throw new BadRequestException(`出库单 ${o.orderNo} 不属于该仓库`);
        }
        if (o.status !== 'ALLOCATED') {
          throw new BadRequestException(`出库单 ${o.orderNo} 状态为 ${o.status}，仅 ALLOCATED 可加入波次`);
        }
        const active = o.waveOrders.find((wo) => ACTIVE_WAVE_STATUSES.includes(wo.wave.status));
        if (active) {
          throw new BadRequestException(`出库单 ${o.orderNo} 已在波次 ${active.wave.waveNo} 中`);
        }
      }

      const count = await tx.wave.count();
      const waveNo = `WV-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${String(count + 1).padStart(4, '0')}`;

      const wave = await tx.wave.create({
        data: {
          waveNo,
          warehouseId: dto.warehouseId,
          strategy: dto.strategy ?? 'PICK_AND_PASS',
          status: 'PENDING',
          orderCount: orders.length,
          waveOrders: { create: orders.map((o) => ({ outboundOrderId: o.id })) },
        },
      });

      for (const o of orders) {
        assertTransition(o.status, 'WAVE_ASSIGNED', OUTBOUND_TRANSITIONS, '出库单');
        await tx.outboundOrder.update({ where: { id: o.id }, data: { status: 'WAVE_ASSIGNED' } });
        await this.opLog.log(
          {
            entityType: 'OUTBOUND_ORDER', entityId: o.id, action: 'WAVE_ASSIGN',
            beforeData: { status: o.status }, afterData: { status: 'WAVE_ASSIGNED', waveNo },
            description: `出库单 ${o.orderNo} 加入波次 ${waveNo}`,
          },
          tx,
        );
      }

      await this.opLog.log(
        {
          entityType: 'WAVE', entityId: wave.id, action: 'CREATE',
          beforeData: {}, afterData: { waveNo, strategy: wave.strategy, orderCount: orders.length },
          description: `波次 ${waveNo} 创建 (${orders.length} 单, ${wave.strategy})`,
        },
        tx,
      );

      return wave;
    });
  }

  // ─── Release (发放拣货：WAVE_ASSIGNED → PICKING) ────────────────────

  async release(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const wave = await tx.wave.findUnique({
        where: { id },
        include: { waveOrders: { include: { outboundOrder: true } } },
      });
      if (!wave) throw new NotFoundException('波次不存在');
      assertTransition(wave.status, 'RELEASED', WAVE_TRANSITIONS, '波次');

      for (const wo of wave.waveOrders) {
        const o = wo.outboundOrder;
        assertTransition(o.status, 'PICKING', OUTBOUND_TRANSITIONS, '出库单');
        await tx.outboundOrder.update({ where: { id: o.id }, data: { status: 'PICKING' } });
        await this.opLog.log(
          {
            entityType: 'OUTBOUND_ORDER', entityId: o.id, action: 'START_PICKING',
            beforeData: { status: o.status }, afterData: { status: 'PICKING' },
            description: `出库单 ${o.orderNo} 随波次 ${wave.waveNo} 发放拣货`,
          },
          tx,
        );
      }

      const updated = await tx.wave.update({ where: { id }, data: { status: 'RELEASED' } });
      await this.opLog.log(
        {
          entityType: 'WAVE', entityId: id, action: 'RELEASE',
          beforeData: { status: wave.status }, afterData: { status: 'RELEASED' },
          description: `波次 ${wave.waveNo} 发放拣货 (${wave.waveOrders.length} 单)`,
        },
        tx,
      );
      return updated;
    });
  }

  // ─── Complete (波次完成：守卫所有成员单已拣货) ─────────────────────

  async complete(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const wave = await tx.wave.findUnique({
        where: { id },
        include: { waveOrders: { include: { outboundOrder: true } } },
      });
      if (!wave) throw new NotFoundException('波次不存在');
      assertTransition(wave.status, 'COMPLETED', WAVE_TRANSITIONS, '波次');

      const notPicked = wave.waveOrders.filter(
        (wo) => !PICKED_OR_BEYOND.includes(wo.outboundOrder.status),
      );
      if (notPicked.length > 0) {
        throw new BadRequestException(`尚有 ${notPicked.length} 个出库单未完成拣货，无法完成波次`);
      }

      const updated = await tx.wave.update({ where: { id }, data: { status: 'COMPLETED' } });
      await this.opLog.log(
        {
          entityType: 'WAVE', entityId: id, action: 'COMPLETE',
          beforeData: { status: wave.status }, afterData: { status: 'COMPLETED' },
          description: `波次 ${wave.waveNo} 完成`,
        },
        tx,
      );
      return updated;
    });
  }

  // ─── Cancel (仅 PENDING：成员单 WAVE_ASSIGNED → ALLOCATED 退回分配池) ─

  async cancel(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const wave = await tx.wave.findUnique({
        where: { id },
        include: { waveOrders: { include: { outboundOrder: true } } },
      });
      if (!wave) throw new NotFoundException('波次不存在');
      assertTransition(wave.status, 'CANCELLED', WAVE_TRANSITIONS, '波次');

      for (const wo of wave.waveOrders) {
        const o = wo.outboundOrder;
        // Un-assign: WAVE_ASSIGNED → ALLOCATED. Inventory-neutral — allocations were made
        // before the wave (allocate()) and are never touched by wave operations.
        assertTransition(o.status, 'ALLOCATED', OUTBOUND_TRANSITIONS, '出库单');
        await tx.outboundOrder.update({ where: { id: o.id }, data: { status: 'ALLOCATED' } });
        await this.opLog.log(
          {
            entityType: 'OUTBOUND_ORDER', entityId: o.id, action: 'WAVE_UNASSIGN',
            beforeData: { status: o.status }, afterData: { status: 'ALLOCATED' },
            description: `出库单 ${o.orderNo} 移出已取消波次 ${wave.waveNo}`,
          },
          tx,
        );
      }

      const updated = await tx.wave.update({ where: { id }, data: { status: 'CANCELLED' } });
      await this.opLog.log(
        {
          entityType: 'WAVE', entityId: id, action: 'CANCEL',
          beforeData: { status: wave.status }, afterData: { status: 'CANCELLED' },
          description: `波次 ${wave.waveNo} 已取消`,
        },
        tx,
      );
      return updated;
    });
  }

  // ─── Detail ─────────────────────────────────────────────────────────

  async detail(id: string) {
    const wave = await this.prisma.wave.findUnique({
      where: { id },
      include: {
        waveOrders: { include: { outboundOrder: { include: { customer: true, items: true } } } },
      },
    });
    if (!wave) throw new NotFoundException('波次不存在');

    const { waveOrders, ...fields } = wave;
    return {
      ...fields,
      orders: waveOrders.map((wo) => {
        const o = wo.outboundOrder;
        return {
          id: o.id,
          orderNo: o.orderNo,
          customerName: o.customer?.name ?? 'Unknown',
          status: o.status,
          totalItems: o.items.reduce((s, i) => s + i.requiredQty, 0),
        };
      }),
    };
  }

  // ─── Pick list (strategy-shaped, derived from the FIFO allocation ledger) ─

  async pickList(id: string) {
    const wave = await this.prisma.wave.findUnique({
      where: { id },
      include: {
        waveOrders: {
          include: {
            outboundOrder: {
              include: {
                items: {
                  include: {
                    product: true,
                    allocations: { include: { inventory: { include: { location: true } } } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!wave) throw new NotFoundException('波次不存在');

    // Flatten member orders to (orderNo, sku, productName, locationCode, qty) tuples
    // straight from OutboundAllocation — the rows allocate() (FIFO) already created.
    type Tuple = { orderNo: string; sku: string; productName: string; locationCode: string; qty: number };
    const tuples: Tuple[] = [];
    for (const wo of wave.waveOrders) {
      const o = wo.outboundOrder;
      for (const item of o.items) {
        for (const alloc of item.allocations) {
          tuples.push({
            orderNo: o.orderNo,
            sku: item.product?.sku ?? '',
            productName: item.product?.name ?? '',
            locationCode: alloc.inventory?.location?.code ?? '',
            qty: alloc.qty,
          });
        }
      }
    }

    if (wave.strategy === 'BATCH_SOW') {
      // 播种: aggregate by (sku, location) with a per-order "sow" breakdown.
      const byKey = new Map<
        string,
        { sku: string; productName: string; locationCode: string; totalQty: number; sow: { orderNo: string; qty: number }[] }
      >();
      for (const t of tuples) {
        const key = `${t.sku}@@${t.locationCode}`;
        let g = byKey.get(key);
        if (!g) {
          g = { sku: t.sku, productName: t.productName, locationCode: t.locationCode, totalQty: 0, sow: [] };
          byKey.set(key, g);
        }
        g.totalQty += t.qty;
        const ex = g.sow.find((s) => s.orderNo === t.orderNo);
        if (ex) ex.qty += t.qty;
        else g.sow.push({ orderNo: t.orderNo, qty: t.qty });
      }
      return { waveNo: wave.waveNo, strategy: wave.strategy, lines: [...byKey.values()] };
    }

    // 摘果 (PICK_AND_PASS): group lines by order.
    const byOrder = new Map<string, { orderNo: string; lines: { sku: string; productName: string; locationCode: string; qty: number }[] }>();
    for (const t of tuples) {
      let g = byOrder.get(t.orderNo);
      if (!g) {
        g = { orderNo: t.orderNo, lines: [] };
        byOrder.set(t.orderNo, g);
      }
      g.lines.push({ sku: t.sku, productName: t.productName, locationCode: t.locationCode, qty: t.qty });
    }
    return { waveNo: wave.waveNo, strategy: wave.strategy, orders: [...byOrder.values()] };
  }
}
