import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { ok } from '../common/api-response';
import { PutawayTasksService } from './putaway-tasks.service';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('putaway-tasks')
export class PutawayTasksController {
  constructor(private readonly putawayTasksService: PutawayTasksService) {}

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR')
  @Get()
  async list(
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('status') status?: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED',
  ) {
    const result = await this.putawayTasksService.list({ page, pageSize, status });
    return ok(result.data, result.pagination);
  }

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR')
  @Put(':id/putaway')
  async putaway(
    @Param('id') id: string,
    @Body()
    body: {
      locationId: string;
      qty: number;
    },
  ) {
    return ok(await this.putawayTasksService.putaway(id, body));
  }
}