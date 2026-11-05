import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ok } from '../common/api-response';
import { Roles } from '../common/decorators/roles.decorator';
import { TaxRatesService } from './tax-rates.service';
import { CreateTaxRateDto, ListTaxRatesQueryDto, UpdateTaxRateDto } from './dto/tax-rate.dto';

// Global prefix 'api/v1' is applied in main.ts — keep the path bare here.
//
// Tax rates are law, not a commercial price list, so reads are SUPER_ADMIN + FINANCE
// (the people who invoice and must be able to audit the rate a bill used) and every
// write is SUPER_ADMIN only. There is deliberately NO delete: a rate that stops
// applying is end-dated (effectiveTo) and/or switched off (isActive=false) so a bill
// generated last month still reproduces against the rate that was in force then.
@Controller('tax-rates')
export class TaxRatesController {
  constructor(private readonly svc: TaxRatesService) {}

  @Roles('SUPER_ADMIN', 'FINANCE')
  @Get()
  async list(@Query() q: ListTaxRatesQueryDto) {
    const r = await this.svc.list(q);
    return ok(r.data, r.pagination);
  }

  @Roles('SUPER_ADMIN')
  @Post()
  async create(@Body() dto: CreateTaxRateDto) {
    return ok(await this.svc.create(dto));
  }

  /**
   * Partial edit of the mutable fields only. Changing a rate is NOT an in-place edit:
   * end-date the current row (effectiveTo) and POST a new row with a later
   * effectiveFrom — otherwise past bills would re-price under the new rate.
   */
  @Roles('SUPER_ADMIN')
  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateTaxRateDto) {
    return ok(await this.svc.update(id, dto));
  }
}
