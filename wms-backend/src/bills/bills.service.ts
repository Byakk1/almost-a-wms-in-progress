import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class BillsService {
  constructor(private prisma: PrismaService) {}

  async generateMonthlyBill(customerId: string, period: string) {
    // Basic mock logic: In a real system you would query `OutboundOrder` or `ReceivingOrder` within the time period.
    const existingBill = await this.prisma.customerBill.findFirst({
      where: { customerId, period }
    });

    if (existingBill) {
      throw new BadRequestException(`Bill for period ${period} already exists.`);
    }

    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new BadRequestException('Customer not found');

    const billNo = `BILL-${period.replace('-', '')}-${Math.floor(Math.random() * 10000)}`;

    return this.prisma.$transaction(async (tx) => {
      // Mock generated amounts for demo
      const baseFee = 500;
      const storageFee = 150.5;
      const outboundFee = 850.75;
      const totalAmount = baseFee + storageFee + outboundFee;

      const bill = await tx.customerBill.create({
        data: {
          billNo,
          customerId,
          period,
          amount: totalAmount,
          status: 'unpaid',
          dueDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // 15 days from now
          items: {
            create: [
              { feeType: 'BASE_FEE', description: 'Monthly subscription base fee', qty: 1, unitPrice: baseFee, totalAmount: baseFee },
              { feeType: 'STORAGE_FEE', description: 'Monthly storage fee', qty: 1, unitPrice: storageFee, totalAmount: storageFee },
              { feeType: 'OUTBOUND_FEE', description: 'Outbound handling and shipping fees', qty: 1, unitPrice: outboundFee, totalAmount: outboundFee },
            ]
          }
        },
        include: { items: true }
      });

      return bill;
    });
  }

  async listBills(customerId?: string) {
    const where = customerId ? { customerId } : {};
    return this.prisma.customerBill.findMany({
      where,
      include: { customer: true },
      orderBy: { createdAt: 'desc' }
    });
  }
}
