import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ok } from '../common/api-response';
import { InventoryService } from './inventory.service';
import { Roles } from '../common/decorators/roles.decorator';
import { AdjustInventoryDto } from './dto/adjust-inventory.dto';

@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR', 'CUSTOMER_SERVICE')
  @Get()
  async list(
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('sku') sku?: string,
    @Query('customerName') customerName?: string,
    @Query('locationCode') locationCode?: string,
  ) {
    const result = await this.inventoryService.list({ page, pageSize, sku, customerName, locationCode });
    return ok(result.data, result.pagination);
  }

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR', 'CUSTOMER_SERVICE', 'FINANCE')
  @Get('summary')
  async summary() {
    return ok(await this.inventoryService.summary());
  }

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR')
  @Post('adjust')
  async adjust(@Body() body: AdjustInventoryDto) {
    return ok(await this.inventoryService.adjust(body));
  }
}