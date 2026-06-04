import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  // Start of the current calendar day (server local time); basis for "today" metrics.
  // The schema has no dedicated shipped/completed timestamps, so createdAt is used.
  private startOfToday(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  async stats() {
    const todayStart = this.startOfToday();

    const [inboundAgg, outboundAgg, pendingOrders, pendingSignout, distinctSkus, recvExc, outExc] =
      await Promise.all([
        // 今日入库量: qty received on receiving orders created today
        this.prisma.receivingOrder.aggregate({
          _sum: { actualQuantity: true },
          where: { createdAt: { gte: todayStart } },
        }),
        // 今日出库量: items packed on outbound orders created today
        this.prisma.outboundItem.aggregate({
          _sum: { packedQty: true },
          where: { outboundOrder: { createdAt: { gte: todayStart } } },
        }),
        // 待处理任务: receiving orders not yet in a terminal state
        this.prisma.receivingOrder.count({
          where: { status: { notIn: ['PUTAWAY_COMPLETED', 'EXCEPTION_CLOSED'] } },
        }),
        // 已分配签出: outbound orders packed/shipped, awaiting sign-out
        this.prisma.outboundOrder.count({ where: { status: { in: ['PACKED', 'SHIPPED'] } } }),
        // 在库 SKUs: distinct products that currently have inventory rows
        this.prisma.inventory.findMany({ distinct: ['productId'], select: { productId: true } }),
        // 异常状况: orders currently in EXCEPTION state (receiving + outbound)
        this.prisma.receivingOrder.count({ where: { status: 'EXCEPTION' } }),
        this.prisma.outboundOrder.count({ where: { status: 'EXCEPTION' } }),
      ]);

    return {
      todayInbound: inboundAgg._sum.actualQuantity ?? 0,
      todayOutbound: outboundAgg._sum.packedQty ?? 0,
      pendingOrders,
      totalSkus: distinctSkus.length,
      exceptionCount: recvExc + outExc,
      pendingSignout,
    };
  }

  async trend(days = 7) {
    const len = Math.max(1, Number(days));
    const today = this.startOfToday();

    // Day buckets [oldest … today], each [start, end), labelled MM-DD.
    const buckets = Array.from({ length: len }, (_, i) => {
      const start = new Date(today);
      start.setDate(start.getDate() - (len - 1 - i));
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      const label = `${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
      return { start, end, label };
    });
    const rangeStart = buckets[0].start;

    const [receiving, outbound] = await Promise.all([
      this.prisma.receivingOrder.findMany({
        where: { createdAt: { gte: rangeStart } },
        select: { createdAt: true, actualQuantity: true },
      }),
      this.prisma.outboundItem.findMany({
        where: { outboundOrder: { createdAt: { gte: rangeStart } } },
        select: { packedQty: true, outboundOrder: { select: { createdAt: true } } },
      }),
    ]);

    const labels = buckets.map((b) => b.label);
    const inbound = buckets.map((b) =>
      receiving
        .filter((r) => r.createdAt >= b.start && r.createdAt < b.end)
        .reduce((sum, r) => sum + r.actualQuantity, 0),
    );
    const outboundSeries = buckets.map((b) =>
      outbound
        .filter((o) => o.outboundOrder.createdAt >= b.start && o.outboundOrder.createdAt < b.end)
        .reduce((sum, o) => sum + o.packedQty, 0),
    );

    return { labels, inbound, outbound: outboundSeries };
  }

  async todos() {
    const [pendingReceiving, pendingPutaway, lowStock] = await Promise.all([
      this.prisma.receivingOrder.count({
        where: { status: { notIn: ['PUTAWAY_COMPLETED', 'EXCEPTION_CLOSED'] } },
      }),
      this.prisma.putawayTask.count({ where: { status: { not: 'COMPLETED' } } }),
      this.prisma.inventory.count({
        where: { availableQty: { lt: this.prisma.inventory.fields.safetyStock } },
      }),
    ]);

    return [
      { id: 'todo-1', type: 'receiving', title: '待完成收货单', count: pendingReceiving },
      { id: 'todo-2', type: 'putaway', title: '待上架任务', count: pendingPutaway },
      { id: 'todo-3', type: 'inventory', title: '低库存预警', count: lowStock },
    ];
  }

  async warehouseUtilization() {
    const [total, occupied, reserved, empty] = await Promise.all([
      this.prisma.location.count({ where: { status: { not: 'DISABLED' } } }),
      this.prisma.location.count({ where: { status: 'OCCUPIED' } }),
      this.prisma.location.count({ where: { status: 'RESERVED' } }),
      this.prisma.location.count({ where: { status: 'EMPTY' } }),
    ]);

    const utilizationRate = Math.round(((occupied + reserved) / (total || 1)) * 100);

    return { total, occupied, reserved, empty, utilizationRate };
  }
}
