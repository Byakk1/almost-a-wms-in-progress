import { Injectable, NotFoundException } from '@nestjs/common';
import { CustomerStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OperationLogService } from '../common/operation-log.service';
import { CreateCustomerTransactionDto } from './dto/create-customer-transaction.dto';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly opLog: OperationLogService,
  ) {}

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

  // ─── Account transactions (账户流水) ─────────────────────────────────

  /**
   * List account movements. `CustomerTransaction` has existed in the schema since the
   * initial import but had no code path at all — no endpoint ever read or wrote it.
   */
  async listTransactions(query: {
    page?: number;
    pageSize?: number;
    customerId?: string;
    type?: string;
  }) {
    const page = Number(query.page ?? 1);
    const pageSize = Number(query.pageSize ?? 20);

    const where: any = {};
    if (query.customerId) where.customerId = query.customerId;
    if (query.type) where.type = query.type;

    const [rows, total] = await Promise.all([
      this.prisma.customerTransaction.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { customer: { select: { name: true, code: true, balance: true } } },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.customerTransaction.count({ where }),
    ]);

    return {
      data: rows.map((r) => ({
        id: r.id,
        customerId: r.customerId,
        customerName: r.customer?.name ?? '',
        customerCode: r.customer?.code ?? '',
        type: r.type,
        amount: Number(r.amount),
        description: r.description ?? '',
        createdAt: this.formatDate(r.createdAt),
      })),
      pagination: { page, pageSize, total },
    };
  }

  /**
   * Record an account movement and apply it to the customer's balance atomically.
   *
   * `amount` is the signed delta, so a deduction is negative; `type` only classifies
   * the movement. Balance is read and written inside the transaction so concurrent
   * movements cannot interleave and lose one another.
   *
   * No credit-limit check — see CreateCustomerTransactionDto for why.
   */
  async createTransaction(dto: CreateCustomerTransactionDto) {
    return this.prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findUnique({ where: { id: dto.customerId } });
      if (!customer) throw new NotFoundException('客户不存在');

      const before = Number(customer.balance);
      const after = before + dto.amount;

      const created = await tx.customerTransaction.create({
        data: {
          customerId: dto.customerId,
          type: dto.type,
          amount: dto.amount,
          description: dto.description,
        },
      });

      const updated = await tx.customer.update({
        where: { id: dto.customerId },
        data: { balance: after },
      });

      // balanceBefore/After are not columns on CustomerTransaction, so the audit row
      // is what preserves the before/after pair for reconciliation.
      await this.opLog.log(
        {
          entityType: 'CUSTOMER', entityId: dto.customerId, action: 'ACCOUNT_TRANSACTION',
          beforeData: { balance: before },
          afterData: { balance: after, type: dto.type, amount: dto.amount },
          description: `客户 ${customer.name} 账户${dto.type === 'topup' ? '充值' : dto.type === 'deduction' ? '扣款' : '调整'} ${dto.amount}，余额 ${before} → ${after}`,
        },
        tx,
      );

      return {
        id: created.id,
        customerId: dto.customerId,
        customerName: customer.name,
        type: created.type,
        amount: Number(created.amount),
        description: created.description ?? '',
        balanceBefore: before,
        balanceAfter: Number(updated.balance),
        createdAt: this.formatDate(created.createdAt),
      };
    });
  }

  private formatDate(date: Date) {
    const iso = date.toISOString();
    return iso.slice(0, 19).replace('T', ' ');
  }
}