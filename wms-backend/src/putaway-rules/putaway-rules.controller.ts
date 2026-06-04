import { Controller, Get, Query } from '@nestjs/common';
import { ok } from '../common/api-response';
import { PutawayRulesService } from './putaway-rules.service';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('putaway-rules')
export class PutawayRulesController {
  constructor(private readonly putawayRulesService: PutawayRulesService) {}

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN')
  @Get()
  async list(@Query('warehouseId') warehouseId?: string) {
    return ok(await this.putawayRulesService.findAll(warehouseId));
  }
}
