import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ok } from '../common/api-response';
import { WavesService } from './waves.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateWaveDto } from './dto/create-wave.dto';

@Controller()
export class WavesController {
  constructor(private readonly svc: WavesService) {}

  // ─── List ───────────────────────────────────────────────────────────

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR', 'CUSTOMER_SERVICE')
  @Get('waves')
  async list(
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('status') status?: string,
  ) {
    const result = await this.svc.list({ page, pageSize, status });
    return ok(result.data, result.pagination);
  }

  // ─── Detail ─────────────────────────────────────────────────────────

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR', 'CUSTOMER_SERVICE')
  @Get('waves/:id')
  async detail(@Param('id') id: string) {
    return ok(await this.svc.detail(id));
  }

  // ─── Pick list (strategy-shaped) ────────────────────────────────────

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR', 'CUSTOMER_SERVICE')
  @Get('waves/:id/pick-list')
  async pickList(@Param('id') id: string) {
    return ok(await this.svc.pickList(id));
  }

  // ─── Create (建波次) ────────────────────────────────────────────────

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR')
  @Post('waves')
  async create(@Body() body: CreateWaveDto) {
    return ok(await this.svc.create(body));
  }

  // ─── Actions ────────────────────────────────────────────────────────

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR')
  @Post('waves/:id/release')
  async release(@Param('id') id: string) {
    return ok(await this.svc.release(id));
  }

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR')
  @Post('waves/:id/complete')
  async complete(@Param('id') id: string) {
    return ok(await this.svc.complete(id));
  }

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR')
  @Post('waves/:id/cancel')
  async cancel(@Param('id') id: string) {
    return ok(await this.svc.cancel(id));
  }
}
