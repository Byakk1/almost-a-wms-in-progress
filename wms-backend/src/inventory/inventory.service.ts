import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OperationLogService } from '../common/operation-log.service';
import { InventoryTransactionService } from '../common/inventory-transaction.service';
import { AdjustInventoryDto } from './dto/adjust-inventory.dto';

interface ListInventoryQuery {
  page?: number;
  pageSize?: number;
  sku?: string;
  customerName?: string;
  locationCode?: string;
}

// Flattened row shape consumed by the frontend (matches the legacy InventoryRecord).
function toRow(r: {
  id: string;
  batchNo: string | null;
  availableQty: number;
  frozenQty: number;
  totalQty: number;
  safetyStock: number;
  unit: string;
  updatedAt: Date;
  product?: { sku: string; name: string } | null;
  location?: { code: string } | null;
  warehouse?: { code: string } | null;
}) {
  return {
    id: r.id,
    sku: r.product?.sku ?? '',
    productName: r.product?.name ?? '',
    warehouseCode: r.warehouse?.code ?? '',
    locationCode: r.location?.code ?? '',
    batchNo: r.batchNo ?? '',
    availableQty: r.availableQty,
    frozenQty: r.frozenQty,
    totalQty: r.totalQty,
    safetyStock: r.safetyStock,
    unit: r.unit,
    lastUpdated: r.updatedAt.toISOString().slice(0, 19).replace('T', ' '),
  };
}

const ROW_INCLUDE = {
  product: { select: { sku: true, name: true } },
  location: { select: { code: true } },
  warehouse: { select: { code: true } },
} as const;

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly opLog: OperationLogService,
    private readonly invTx: InventoryTransactionService,
  ) {}

  async list(query: ListInventoryQuery) {
    const page = Number(query.page ?? 1);
    const pageSize = Number(query.pageSize ?? 20);

    const where: any = {};
    if (query.sku) {
      where.product = { sku: { contains: query.sku, mode: 'insensitive' } };
    }
    if (query.customerName) {
      where.customer = { name: { contains: query.customerName, mode: 'insensitive' } };
    }
    if (query.locationCode) {
      where.location = { code: { contains: query.locationCode, mode: 'insensitive' } };
    }

    const [rows, total] = await Promise.all([
      this.prisma.inventory.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: ROW_INCLUDE,
        orderBy: { inboundDate: 'asc' }, // FIFO-friendly default ordering
      }),
      this.prisma.inventory.count({ where }),
    ]);

    return { data: rows.map(toRow), pagination: { page, pageSize, total } };
  }

  async summary() {
    const [agg, distinctProducts, lowStockCount] = await Promise.all([
      this.prisma.inventory.aggregate({
        _sum: { totalQty: true, availableQty: true, frozenQty: true },
      }),
      this.prisma.inventory.findMany({ distinct: ['productId'], select: { productId: true } }),
      this.prisma.inventory.count({
        where: { availableQty: { lt: this.prisma.inventory.fields.safetyStock } },
      }),
    ]);

    return {
      totalSkus: distinctProducts.length,
      totalQty: agg._sum.totalQty ?? 0,
      availableQty: agg._sum.availableQty ?? 0,
      frozenQty: agg._sum.frozenQty ?? 0,
      lowStockCount,
    };
  }

  async adjust(body: AdjustInventoryDto) {
    const row = await this.prisma.inventory.findFirst({
      where: { product: { sku: body.sku }, location: { code: body.locationCode } },
    });
    if (!row) {
      return false;
    }

    // deltaQty is validated as a finite integer by AdjustInventoryDto (@IsInt).
    const deltaQty = body.deltaQty;

    // Negative-stock guard: an adjustment must not drive available (or total) below 0.
    const nextAvailable = row.availableQty + deltaQty;
    const nextTotal = row.totalQty + deltaQty;
    if (nextAvailable < 0 || nextTotal < 0) {
      throw new BadRequestException(
        `调整后库存为负：可用 ${row.availableQty}→${nextAvailable}，总量 ${row.totalQty}→${nextTotal}`,
      );
    }

    const reason = body.reason?.trim() || '手工调整';

    // The mutation and both audit writes share one transaction, so stock can never
    // move without leaving a trace (manual adjustment is the most audit-sensitive
    // operation here — it is the only one with no source document behind it).
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.inventory.update({
        where: { id: row.id },
        data: {
          availableQty: nextAvailable,
          totalQty: nextTotal,
        },
        include: ROW_INCLUDE,
      });

      // qtyBefore/qtyAfter track availableQty, matching the FREEZE/OUTBOUND rows
      // already written elsewhere so the 库存流水 columns mean the same thing
      // regardless of transaction type.
      await this.invTx.record(
        {
          warehouseId: row.warehouseId,
          customerId: row.customerId ?? undefined,
          productId: row.productId,
          locationId: row.locationId ?? undefined,
          batchNo: row.batchNo ?? undefined,
          type: 'ADJUST',
          qtyBefore: row.availableQty,
          qtyChange: deltaQty,
          qtyAfter: nextAvailable,
          refType: 'MANUAL_ADJUST',
          reason,
        },
        tx,
      );

      await this.opLog.log(
        {
          entityType: 'INVENTORY',
          entityId: row.id,
          action: 'ADJUST',
          beforeData: { availableQty: row.availableQty, totalQty: row.totalQty },
          afterData: { availableQty: nextAvailable, totalQty: nextTotal },
          description: `库存调整 ${body.sku} @ ${body.locationCode}：${deltaQty > 0 ? '+' : ''}${deltaQty}（${reason}）`,
        },
        tx,
      );

      return { ...toRow(updated), reason };
    });
  }
}
