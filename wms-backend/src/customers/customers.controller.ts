import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ok } from '../common/api-response';
import { CustomersService } from './customers.service';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'CUSTOMER_SERVICE', 'FINANCE')
  @Get()
  async list(
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('keyword') keyword?: string,
    @Query('status') status?: 'ACTIVE' | 'INACTIVE',
  ) {
    const result = await this.customersService.list({ page, pageSize, keyword, status });
    return ok(result.data, result.pagination);
  }

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'CUSTOMER_SERVICE')
  @Post()
  async create(
    @Body()
    body: {
      customerCode: string;
      name: string;
      contactName?: string;
      phone?: string;
      level?: 'NORMAL' | 'VIP' | 'VVIP';
      creditLimit?: number;
    },
  ) {
    return ok(await this.customersService.create(body));
  }

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'CUSTOMER_SERVICE', 'FINANCE')
  @Get(':id')
  async detail(@Param('id') id: string) {
    return ok(await this.customersService.detail(id));
  }

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'CUSTOMER_SERVICE')
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body()
    body: Partial<{
      name: string;
      contactName: string;
      phone: string;
      level: 'NORMAL' | 'VIP' | 'VVIP';
      creditLimit: number;
      balance: number;
    }>,
  ) {
    return ok(await this.customersService.update(id, body));
  }

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN')
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return ok(await this.customersService.remove(id));
  }

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'CUSTOMER_SERVICE')
  @Put(':id/status')
  async changeStatus(@Param('id') id: string, @Body() body: { status: 'ACTIVE' | 'INACTIVE' }) {
    return ok(await this.customersService.changeStatus(id, body.status));
  }
}