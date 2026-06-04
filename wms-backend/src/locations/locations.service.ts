import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { LocationStatus } from '@prisma/client';

interface ListLocationsQuery {
  floor?: number;
  status?: LocationStatus;
  warehouseId?: string;
}

@Injectable()
export class LocationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListLocationsQuery) {
    const where: any = {};
    if (query.floor !== undefined) where.floor = Number(query.floor);
    if (query.status) where.status = query.status;
    if (query.warehouseId) where.warehouseId = query.warehouseId;

    return this.prisma.location.findMany({
      where,
      orderBy: [{ zone: 'asc' }, { row: 'asc' }, { col: 'asc' }],
    });
  }

  async create(body: {
    code: string;
    warehouseId: string;
    zone?: string;
    row: string;
    col: number;
    floor?: number;
    status?: LocationStatus;
  }) {
    if (!body.warehouseId) {
      throw new BadRequestException('warehouseId is required');
    }
    return this.prisma.location.create({
      data: {
        code: body.code,
        warehouseId: body.warehouseId,
        zone: body.zone,
        row: body.row,
        col: Number(body.col),
        floor: body.floor !== undefined ? Number(body.floor) : undefined,
        status: body.status ?? 'EMPTY',
      },
    });
  }

  async update(
    id: string,
    body: Partial<{
      code: string;
      zone: string;
      row: string;
      col: number;
      floor: number;
      status: LocationStatus;
    }>,
  ) {
    const existing = await this.prisma.location.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('库位不存在');
    return this.prisma.location.update({ where: { id }, data: body });
  }

  async remove(id: string) {
    const existing = await this.prisma.location.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('库位不存在');
    await this.prisma.location.delete({ where: { id } });
    return true;
  }
}
