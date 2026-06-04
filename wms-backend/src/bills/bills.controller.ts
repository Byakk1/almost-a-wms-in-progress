import { Controller, Post, Body, Get, Query } from '@nestjs/common';
import { BillsService } from './bills.service';
import { Roles } from '../common/decorators/roles.decorator';
import { ok } from '../common/api-response';

@Controller('bills')
export class BillsController {
  constructor(private readonly billsService: BillsService) {}

  @Roles('SUPER_ADMIN', 'FINANCE', 'CUSTOMER_SERVICE')
  @Post('generate')
  async generateBill(
    @Body()
    body: {
      customerId: string;
      period: string; // e.g., '2026-03'
    },
  ) {
    const result = await this.billsService.generateMonthlyBill(body.customerId, body.period);
    return ok(result);
  }

  @Roles('SUPER_ADMIN', 'FINANCE', 'CUSTOMER_SERVICE', 'CUSTOMER')
  @Get()
  async listBills(@Query('customerId') customerId?: string) {
    const result = await this.billsService.listBills(customerId);
    return ok(result);
  }
}
