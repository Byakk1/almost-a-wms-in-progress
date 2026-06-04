import { Controller, Get, Param, Post, Put, Body, Query } from '@nestjs/common';
import { TransitOrdersService } from './transit-orders.service';
import { Roles } from '../common/decorators/roles.decorator';
import { ok } from '../common/api-response';

@Controller('transit-orders')
export class TransitOrdersController {
  constructor(private readonly transitOrdersService: TransitOrdersService) {}

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR', 'CUSTOMER_SERVICE')
  @Get()
  async list(
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('status') status?: string,
  ) {
    const result = await this.transitOrdersService.list({ page, pageSize, status });
    return ok(result);
  }

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR', 'CUSTOMER_SERVICE')
  @Get(':id')
  async detail(@Param('id') id: string) {
    const result = await this.transitOrdersService.detail(id);
    return ok(result);
  }

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR')
  @Put(':id/receive')
  async receive(
    @Param('id') id: string,
    @Body() body: { items: Array<{ productId: string; qty: number }> }
  ) {
    const result = await this.transitOrdersService.receive(id, body.items);
    return ok(result);
  }

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR')
  @Put(':id/ship')
  async ship(
    @Param('id') id: string,
    @Body() body: { trackingNo: string }
  ) {
    const result = await this.transitOrdersService.ship(id, body.trackingNo);
    return ok(result);
  }
}
