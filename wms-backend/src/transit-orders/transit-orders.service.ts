import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class TransitOrdersService {
  constructor(private prisma: PrismaService) {}

  async list(query: { page?: number; pageSize?: number; status?: string }) {
    const page = Number(query.page ?? 1);
    const pageSize = Number(query.pageSize ?? 20);

    const where = query.status ? { status: query.status } : {};

    const [data, total] = await Promise.all([
      this.prisma.transitOrder.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          customer: true,
          items: true
        },
        orderBy: { createdAt: 'desc' }
      }),
      this.prisma.transitOrder.count({ where })
    ]);

    return {
      data: data.map(order => ({
        ...order,
        customerName: order.customer?.name,
        totalItems: order.items.reduce((acc, item) => acc + item.expectedQty, 0)
      })),
      pagination: { page, pageSize, total }
    };
  }

  async detail(id: string) {
    const order = await this.prisma.transitOrder.findUnique({
      where: { id },
      include: {
        customer: true,
        items: {
          include: { product: true }
        }
      }
    });

    if (!order) throw new NotFoundException('Transit order not found');
    return order;
  }

  async receive(id: string, items: Array<{ productId: string; qty: number }>) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.transitOrder.findUnique({
        where: { id },
        include: { items: true }
      });

      if (!order) throw new NotFoundException('Transit order not found');
      if (order.status !== 'PENDING') throw new BadRequestException(`Cannot receive in status ${order.status}`);

      for (const inputItem of items) {
        const item = order.items.find(i => i.productId === inputItem.productId);
        if (!item) throw new BadRequestException(`Product ${inputItem.productId} not found in order`);
        
        await tx.transitItem.update({
          where: { id: item.id },
          data: { actualQty: item.actualQty + inputItem.qty }
        });
      }

      const updatedOrder = await tx.transitOrder.update({
        where: { id },
        data: { status: 'RECEIVED' },
        include: { items: true }
      });

      return updatedOrder;
    });
  }

  async ship(id: string, trackingNo: string) {
    const order = await this.prisma.transitOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Transit order not found');
    if (order.status !== 'RECEIVED') throw new BadRequestException('Order must be received before it can be shipped');

    return this.prisma.transitOrder.update({
      where: { id },
      data: {
        status: 'SHIPPED',
        trackingNo
      }
    });
  }
}
