import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ok } from '../common/api-response';
import { CustomersService } from './customers.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateCustomerTransactionDto } from './dto/create-customer-transaction.dto';

/**
 * Account movements live on their own path rather than under /customers, because
 * CustomersController already owns `@Get(':id')` — a `/customers/transactions`
 * route would be captured by it as an id lookup.
 */
@Controller('customer-transactions')
export class CustomerTransactionsController {
  constructor(private readonly customersService: CustomersService) {}

  // Same audience as the bills list: finance plus the roles that answer for accounts.
  @Roles('SUPER_ADMIN', 'FINANCE', 'CUSTOMER_SERVICE', 'WAREHOUSE_ADMIN')
  @Get()
  async list(
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('customerId') customerId?: string,
    @Query('type') type?: string,
  ) {
    const result = await this.customersService.listTransactions({ page, pageSize, customerId, type });
    return ok(result.data, result.pagination);
  }

  @Roles('SUPER_ADMIN', 'FINANCE')
  @Post()
  async create(@Body() body: CreateCustomerTransactionDto) {
    return ok(await this.customersService.createTransaction(body));
  }
}
