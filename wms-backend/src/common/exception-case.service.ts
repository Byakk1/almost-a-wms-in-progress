import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ExceptionStatus } from '@prisma/client';
import { OperationLogService } from './operation-log.service';

@Injectable()
export class ExceptionCaseService {
  constructor(
    private prisma: PrismaService,
    private opLog: OperationLogService,
  ) {}

  /** Generate sequential case number: EXC-YYMMDD-NNNN */
  private async generateCaseNo(): Promise<string> {
    const today = new Date();
    const yy = String(today.getFullYear()).slice(-2);
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const prefix = `EXC-${yy}${mm}${dd}`;

    const latest = await this.prisma.exceptionCase.findFirst({
      where: { caseNo: { startsWith: prefix } },
      orderBy: { caseNo: 'desc' },
    });

    const seq = latest ? parseInt(latest.caseNo.split('-')[2]) + 1 : 1;
    return `${prefix}-${String(seq).padStart(4, '0')}`;
  }

  async create(dto: {
    entityType: string;
    entityId: string;
    entityNo?: string;
    type: string;
    severity?: string;
    title: string;
    description?: string;
    warehouseId?: string;
    customerId?: string;
    productId?: string;
    locationId?: string;
    attachments?: string[];
    createdBy?: string;
  }) {
    const caseNo = await this.generateCaseNo();

    const record = await this.prisma.exceptionCase.create({
      data: {
        caseNo,
        entityType: dto.entityType,
        entityId: dto.entityId,
        entityNo: dto.entityNo,
        type: dto.type,
        severity: dto.severity || 'MEDIUM',
        title: dto.title,
        description: dto.description,
        warehouseId: dto.warehouseId,
        customerId: dto.customerId,
        productId: dto.productId,
        locationId: dto.locationId,
        attachments: dto.attachments ? JSON.stringify(dto.attachments) : null,
        createdBy: dto.createdBy,
      },
    });

    await this.opLog.log({
      entityType: 'EXCEPTION_CASE',
      entityId: record.id,
      action: 'CREATE',
      afterData: record,
      description: `创建异常工单 ${caseNo}，类型: ${dto.type}`,
    });

    return record;
  }

  async list(params: {
    page?: number;
    pageSize?: number;
    status?: string;
    entityType?: string;
    warehouseId?: string;
    type?: string;
  }) {
    const page = params.page || 1;
    const pageSize = params.pageSize || 20;

    const where: any = {};
    if (params.status) where.status = params.status;
    if (params.entityType) where.entityType = params.entityType;
    if (params.warehouseId) where.warehouseId = params.warehouseId;
    if (params.type) where.type = params.type;

    const [data, total] = await Promise.all([
      this.prisma.exceptionCase.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.exceptionCase.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }

  async detail(id: string) {
    const record = await this.prisma.exceptionCase.findUnique({ where: { id } });
    if (!record) throw new NotFoundException(`异常工单 ${id} 不存在`);
    return record;
  }

  async startProcessing(id: string, operatorId?: string) {
    const record = await this.detail(id);
    if (record.status !== 'OPEN') {
      throw new BadRequestException(`异常工单状态 [${record.status}] 不允许开始处理，仅 OPEN 状态可操作`);
    }

    const updated = await this.prisma.exceptionCase.update({
      where: { id },
      data: { status: ExceptionStatus.IN_PROGRESS },
    });

    await this.opLog.log({
      entityType: 'EXCEPTION_CASE',
      entityId: id,
      action: 'START_PROCESSING',
      beforeData: { status: record.status },
      afterData: { status: updated.status },
      operatorId,
      description: `开始处理异常工单 ${record.caseNo}`,
    });

    return updated;
  }

  async resolve(id: string, dto: { resolution: string; resolvedBy?: string }) {
    const record = await this.detail(id);
    if (record.status !== 'OPEN' && record.status !== 'IN_PROGRESS') {
      throw new BadRequestException(`异常工单状态 [${record.status}] 不允许处理，仅 OPEN / IN_PROGRESS 可操作`);
    }

    const updated = await this.prisma.exceptionCase.update({
      where: { id },
      data: {
        status: ExceptionStatus.RESOLVED,
        resolution: dto.resolution,
        resolvedBy: dto.resolvedBy,
        resolvedAt: new Date(),
      },
    });

    await this.opLog.log({
      entityType: 'EXCEPTION_CASE',
      entityId: id,
      action: 'RESOLVE',
      beforeData: { status: record.status },
      afterData: { status: updated.status, resolution: dto.resolution },
      operatorId: dto.resolvedBy,
      description: `解决异常工单 ${record.caseNo}`,
    });

    return updated;
  }

  async close(id: string, operatorId?: string) {
    const record = await this.detail(id);
    if (record.status !== 'RESOLVED') {
      throw new BadRequestException(`异常工单状态 [${record.status}] 不允许关闭，仅 RESOLVED 可关闭`);
    }

    const updated = await this.prisma.exceptionCase.update({
      where: { id },
      data: { status: ExceptionStatus.CLOSED },
    });

    await this.opLog.log({
      entityType: 'EXCEPTION_CASE',
      entityId: id,
      action: 'CLOSE',
      beforeData: { status: record.status },
      afterData: { status: updated.status },
      operatorId,
      description: `关闭异常工单 ${record.caseNo}`,
    });

    return updated;
  }

  async cancel(id: string, operatorId?: string) {
    const record = await this.detail(id);
    if (record.status === 'CLOSED' || record.status === 'CANCELLED') {
      throw new BadRequestException(`异常工单状态 [${record.status}] 不允许取消`);
    }

    const updated = await this.prisma.exceptionCase.update({
      where: { id },
      data: { status: ExceptionStatus.CANCELLED },
    });

    await this.opLog.log({
      entityType: 'EXCEPTION_CASE',
      entityId: id,
      action: 'CANCEL',
      beforeData: { status: record.status },
      afterData: { status: updated.status },
      operatorId,
      description: `取消异常工单 ${record.caseNo}`,
    });

    return updated;
  }

  /** Get all exceptions for a specific order/task */
  async findByEntity(entityType: string, entityId: string) {
    return this.prisma.exceptionCase.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Dashboard stats: count by status */
  async stats(warehouseId?: string) {
    const where: any = {};
    if (warehouseId) where.warehouseId = warehouseId;

    const [open, inProgress, resolved, total] = await Promise.all([
      this.prisma.exceptionCase.count({ where: { ...where, status: 'OPEN' } }),
      this.prisma.exceptionCase.count({ where: { ...where, status: 'IN_PROGRESS' } }),
      this.prisma.exceptionCase.count({ where: { ...where, status: 'RESOLVED' } }),
      this.prisma.exceptionCase.count({ where }),
    ]);

    return { open, inProgress, resolved, total };
  }
}
