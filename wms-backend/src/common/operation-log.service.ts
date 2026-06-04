import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateOperationLogDto {
  entityType: string;
  entityId: string;
  action: string;
  beforeData?: any;
  afterData?: any;
  description?: string;
  operatorId?: string;
  operatorName?: string;
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class OperationLogService {
  constructor(private prisma: PrismaService) {}

  /**
   * Log a business operation. Automatically serializes before/after data to JSON.
   */
  async log(dto: CreateOperationLogDto, tx?: any) {
    const db = tx || this.prisma;
    return db.operationLog.create({
      data: {
        entityType: dto.entityType,
        entityId: dto.entityId,
        action: dto.action,
        beforeData: dto.beforeData ? JSON.stringify(dto.beforeData) : null,
        afterData: dto.afterData ? JSON.stringify(dto.afterData) : null,
        description: dto.description,
        operatorId: dto.operatorId,
        operatorName: dto.operatorName,
        ip: dto.ip,
        userAgent: dto.userAgent,
      },
    });
  }

  /**
   * Query operation logs for a specific entity (e.g. a receiving order).
   */
  async listByEntity(entityType: string, entityId: string) {
    const rows = await this.prisma.operationLog.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'asc' },
    });

    return rows.map((r) => ({
      ...r,
      beforeData: r.beforeData ? JSON.parse(r.beforeData) : null,
      afterData: r.afterData ? JSON.parse(r.afterData) : null,
    }));
  }

  /**
   * Query recent operations by an operator (for KPI / performance).
   */
  async listByOperator(operatorId: string, page = 1, pageSize = 50) {
    const where = { operatorId };

    const [rows, total] = await Promise.all([
      this.prisma.operationLog.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.operationLog.count({ where }),
    ]);

    return { data: rows, pagination: { page, pageSize, total } };
  }

  /**
   * Query recent operations across all entities (admin audit view).
   */
  async listRecent(page = 1, pageSize = 50) {
    const [rows, total] = await Promise.all([
      this.prisma.operationLog.findMany({
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.operationLog.count(),
    ]);

    return {
      data: rows.map((r) => ({
        ...r,
        beforeData: r.beforeData ? JSON.parse(r.beforeData) : null,
        afterData: r.afterData ? JSON.parse(r.afterData) : null,
      })),
      pagination: { page, pageSize, total },
    };
  }
}
