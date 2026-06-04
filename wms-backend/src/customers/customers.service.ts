import { Injectable, NotFoundException } from '@nestjs/common';
import { CustomerStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

interface ListCustomersQuery {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: 'ACTIVE' | 'INACTIVE';
}

type CustomerApiRow = {
  id: string;
  customerCode: string;
  name: string;
  contactName: string;
  phone: string;
  level: 'NORMAL' | 'VIP' | 'VVIP';
  status: 'ACTIVE' | 'INACTIVE';
  creditLimit: number;
  balance: number;
  createdAt: string;
};

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListCustomersQuery) {
    const page = Number(query.page ?? 1);
    const pageSize = Number(query.pageSize ?? 20);

    const where = {
      ...(query.status ? { status: query.status as CustomerStatus } : {}),
      ...(query.keyword
        ? {
            OR: [
              { name: { contains: query.keyword, mode: 'insensitive' as const } },
              { code: { contains: query.keyword, mode: 'insensitive' as const } },
              { phone: { contains: query.keyword, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [total, rows] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      data: rows.map((row) => this.toApiRow(row)),
      pagination: { page, pageSize, total },
    };
  }

  async create(body: {
    customerCode: string;
    name: string;
    contactName?: string;
    phone?: string;
    level?: 'NORMAL' | 'VIP' | 'VVIP';
    creditLimit?: number;
  }) {
    const row = await this.prisma.customer.create({
      data: {
        code: body.customerCode,
        name: body.name,
        contactName: body.contactName ?? '',
        phone: body.phone ?? '',
        creditLimit: Number(body.creditLimit ?? 0),
        balance: 0,
        status: 'ACTIVE',
      },
    });

    return this.toApiRow(row, body.level ?? 'NORMAL');
  }

  async detail(id: string) {
    const row = await this.prisma.customer.findUnique({ where: { id } });
    if (!row) {
      throw new NotFoundException('客户不存在');
    }
    return this.toApiRow(row);
  }

  async update(
    id: string,
    body: Partial<{
      name: string;
      contactName: string;
      phone: string;
      level: 'NORMAL' | 'VIP' | 'VVIP';
      creditLimit: number;
      balance: number;
    }>,
  ) {
    const exists = await this.prisma.customer.findUnique({ where: { id } });
    if (!exists) {
      throw new NotFoundException('客户不存在');
    }

    const row = await this.prisma.customer.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.contactName !== undefined ? { contactName: body.contactName } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.creditLimit !== undefined ? { creditLimit: Number(body.creditLimit) } : {}),
        ...(body.balance !== undefined ? { balance: Number(body.balance) } : {}),
      },
    });

    return this.toApiRow(row, body.level);
  }

  async remove(id: string) {
    const exists = await this.prisma.customer.findUnique({ where: { id } });
    if (!exists) {
      throw new NotFoundException('客户不存在');
    }
    await this.prisma.customer.delete({ where: { id } });
    return true;
  }

  async changeStatus(id: string, status: 'ACTIVE' | 'INACTIVE') {
    const exists = await this.prisma.customer.findUnique({ where: { id } });
    if (!exists) {
      throw new NotFoundException('客户不存在');
    }

    const row = await this.prisma.customer.update({
      where: { id },
      data: { status: status as CustomerStatus },
    });

    return this.toApiRow(row);
  }

  private toApiRow(
    row: {
      id: string;
      code: string;
      name: string;
      contactName: string | null;
      phone: string | null;
      status: CustomerStatus;
      creditLimit: unknown;
      balance: unknown;
      createdAt: Date;
    },
    level?: 'NORMAL' | 'VIP' | 'VVIP',
  ): CustomerApiRow {
    return {
      id: row.id,
      customerCode: row.code,
      name: row.name,
      contactName: row.contactName ?? '',
      phone: row.phone ?? '',
      level: level ?? 'NORMAL',
      status: row.status,
      creditLimit: Number(row.creditLimit),
      balance: Number(row.balance),
      createdAt: this.formatDate(row.createdAt),
    };
  }

  private formatDate(date: Date) {
    const iso = date.toISOString();
    return iso.slice(0, 19).replace('T', ' ');
  }
}