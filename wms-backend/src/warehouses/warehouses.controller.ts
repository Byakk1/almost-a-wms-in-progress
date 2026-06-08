import { Controller, Get } from '@nestjs/common';
import { ok } from '../common/api-response';
import { WarehousesService } from './warehouses.service';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('warehouses')
export class WarehousesController {
  constructor(private readonly svc: WarehousesService) {}

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR', 'CUSTOMER_SERVICE')
  @Get()
  async list() {
    return ok(await this.svc.list());
  }
}
