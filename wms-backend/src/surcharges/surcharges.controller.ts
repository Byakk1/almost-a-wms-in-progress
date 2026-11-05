import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ok } from '../common/api-response';
import { Roles } from '../common/decorators/roles.decorator';
import { SurchargesService } from './surcharges.service';
import {
  CreateSurchargeDto, ListSurchargesQueryDto, UpdateSurchargeDto,
} from './dto/surcharge.dto';

// Global prefix 'api/v1' is applied in main.ts — keep the path bare here.
//
// Surcharge definitions are commercial configuration, so reads are SUPER_ADMIN +
// FINANCE (the people who invoice and must be able to audit the surcharge a bill
// used) and every write is SUPER_ADMIN only. There is deliberately NO delete: a
// surcharge that stops applying is end-dated (effectiveTo) and/or switched off
// (isActive=false) so a bill generated last month still reproduces against the
// definition that was in force then.
@Controller('surcharges')
export class SurchargesController {
  constructor(private readonly svc: SurchargesService) {}

  @Roles('SUPER_ADMIN', 'FINANCE')
  @Get()
  async list(@Query() q: ListSurchargesQueryDto) {
    const r = await this.svc.list(q);
    return ok(r.data, r.pagination);
  }

  @Roles('SUPER_ADMIN')
  @Post()
  async create(@Body() dto: CreateSurchargeDto) {
    return ok(await this.svc.create(dto));
  }

  /**
   * Partial edit of the mutable fields only: name, value, taxable, carrier, appliesTo,
   * note, effectiveTo, isActive. `code` and `calcType` are NOT editable — a surcharge
   * that changes its nature is a new code (end-date this one and POST another),
   * otherwise past bills would re-price under the new definition. `value` is
   * re-validated against the row's calcType.
   */
  @Roles('SUPER_ADMIN')
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateSurchargeDto) {
    return ok(await this.svc.update(id, dto));
  }
}
