import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateInventoryTxDto {
  warehouseId: string;
  customerId?: string;
  productId: string;
  locationId?: string;
  batchNo?: string;
  type: 'INBOUND' | 'OUTBOUND' | 'ADJUST' | 'FREEZE' | 'UNFREEZE' | 'TRANSFER' | 'PUTAWAY';
  qtyBefore: number;
  qtyChange: number;
  qtyAfter: number;
  refType?: string;
  refId?: string;
  refNo?: string;
  reason?: string;
  operatorId?: string;
  operatorName?: string;
}

@Injectable()
export class InventoryTransactionService {
  constructor(private prisma: PrismaService) {}

  /**
   * Record an inventory change. Should be called inside the same
   * Prisma transaction that mutates the Inventory row.
   */
  async record(data: CreateInventoryTxDto, tx?: any) {
    const db = tx || this.prisma;
    return db.inventoryTransaction.create({ data });
  }

  /**
   * Record multiple inventory changes in bulk (e.g. receiving multiple SKUs).
   */
  async recordMany(items: CreateInventoryTxDto[], tx?: any) {
    const db = tx || this.prisma;
    return db.inventoryTransaction.createMany({ data: items });
  }

  /**
   * Query transaction history for a specific product in a warehouse.
   */
  async listByProduct(query: {
    warehouseId: string;
    productId: string;
    page?: number;
    pageSize?: number;
  }) {
    const page = Number(query.page ?? 1);
    const pageSize = Number(query.pageSize ?? 20);

    const where = {
      warehouseId: query.warehouseId,
      productId: query.productId,
    };

    const [rows, total] = await Promise.all([
      this.prisma.inventoryTransaction.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.inventoryTransaction.count({ where }),
    ]);

    return { data: rows, pagination: { page, pageSize, total } };
  }

  /**
   * Query transaction history for a specific source document.
   */
  async listByRef(refType: string, refId: string) {
    return this.prisma.inventoryTransaction.findMany({
      where: { refType, refId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Query all transactions for a specific location (for location audit).
   */
  async listByLocation(locationId: string, page = 1, pageSize = 20) {
    const where = { locationId };

    const [rows, total] = await Promise.all([
      this.prisma.inventoryTransaction.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.inventoryTransaction.count({ where }),
    ]);

    return { data: rows, pagination: { page, pageSize, total } };
  }
}
