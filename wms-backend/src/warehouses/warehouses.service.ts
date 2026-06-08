import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class WarehousesService {
  constructor(private readonly prisma: PrismaService) {}

  // Read-only list for selectors (e.g. the outbound create form). Warehouses are few — no pagination.
  async list() {
    const rows = await this.prisma.warehouse.findMany({
      where: { isActive: true },
      orderBy: { code: 'asc' },
    });
    return rows.map((w) => ({
      id: w.id,
      code: w.code,
      name: w.name,
      address: w.address ?? null,
    }));
  }
}
