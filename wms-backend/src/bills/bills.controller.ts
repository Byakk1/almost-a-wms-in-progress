import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { BillsService } from './bills.service';
import { Roles } from '../common/decorators/roles.decorator';
import { ok } from '../common/api-response';
import { FinalizeBillDto, GenerateBillDto, ListBillsQueryDto } from './dto/bill.dto';

/**
 * Role split (PRD §10 decision 7): generating and reading a bill is a service
 * function CS may perform; confirming cash receipt (mark-paid) and closing a
 * provisional bill (finalize) are internal-control functions reserved for
 * FINANCE + SUPER_ADMIN. permissions.ts mirrors this as 'bill.pay' / 'bill.finalize'.
 */
@Controller('bills')
export class BillsController {
  constructor(private readonly billsService: BillsService) {}

  @Roles('SUPER_ADMIN', 'FINANCE', 'CUSTOMER_SERVICE')
  @Post('generate')
  async generateBill(@Body() body: GenerateBillDto) {
    const result = await this.billsService.generateMonthlyBill(
      body.customerId, body.period, body.actuals ?? [], body.confirmations ?? [],
    );
    return ok(result);
  }

  @Roles('SUPER_ADMIN', 'FINANCE', 'CUSTOMER_SERVICE', 'CUSTOMER')
  @Get()
  async listBills(@Query() q: ListBillsQueryDto) {
    const { data, pagination } = await this.billsService.listBills(q);
    return ok(data, pagination);
  }

  @Roles('SUPER_ADMIN', 'FINANCE', 'CUSTOMER_SERVICE', 'CUSTOMER')
  @Get(':id')
  async getBill(@Param('id') id: string) {
    return ok(await this.billsService.getBill(id));
  }

  @Roles('SUPER_ADMIN', 'FINANCE')
  @Post(':id/finalize')
  async finalize(@Param('id') id: string, @Body() body: FinalizeBillDto) {
    return ok(await this.billsService.finalize(id, body.actuals ?? [], body.confirmations ?? []));
  }

  @Roles('SUPER_ADMIN', 'FINANCE')
  @Post(':id/mark-paid')
  async markPaid(@Param('id') id: string) {
    return ok(await this.billsService.markPaid(id));
  }
}
