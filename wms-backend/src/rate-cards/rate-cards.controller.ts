import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ok } from '../common/api-response';
import { Roles } from '../common/decorators/roles.decorator';
import { RateCardsService } from './rate-cards.service';
import { CreateRateCardDto } from './dto/create-rate-card.dto';
import {
  AddRateCardItemsDto, AddShippingZonesDto, AssignRateCardDto, QuoteDto,
} from './dto/rate-card-ops.dto';

// Global prefix 'api/v1' is applied in main.ts — keep the path bare here.
//
// Roles: rate cards are commercial pricing, so writes are FINANCE + SUPER_ADMIN only,
// deliberately tighter than the OPS_CS used elsewhere. Reads add CUSTOMER_SERVICE
// (they field "what will this cost" calls) but NOT OPERATOR or CUSTOMER — a warehouse
// operator has no reason to read the full commercial price list.
@Controller('rate-cards')
export class RateCardsController {
  constructor(private readonly svc: RateCardsService) {}

  // ─── Quote (询价) ────────────────────────────────────────────────────
  // Declared before ':id' so 'quote' is never read as a card id.

  @Roles('SUPER_ADMIN', 'FINANCE', 'CUSTOMER_SERVICE', 'WAREHOUSE_ADMIN')
  @Post('quote')
  async quote(@Body() body: QuoteDto) {
    return ok(await this.svc.quote(body));
  }

  // ─── Assignment (客户绑定) ───────────────────────────────────────────

  @Roles('SUPER_ADMIN', 'FINANCE')
  @Post('assign')
  async assign(@Body() body: AssignRateCardDto) {
    return ok(await this.svc.assign(body));
  }

  @Roles('SUPER_ADMIN', 'FINANCE')
  @Delete('assign/:customerId/:rateCardId')
  async unassign(
    @Param('customerId') customerId: string,
    @Param('rateCardId') rateCardId: string,
  ) {
    return ok(await this.svc.unassign(customerId, rateCardId));
  }

  // ─── Items (明细) ────────────────────────────────────────────────────

  @Roles('SUPER_ADMIN', 'FINANCE')
  @Delete('items/:itemId')
  async removeItem(@Param('itemId') itemId: string) {
    return ok(await this.svc.removeItem(itemId));
  }

  // ─── Cards ──────────────────────────────────────────────────────────

  @Roles('SUPER_ADMIN', 'FINANCE', 'CUSTOMER_SERVICE', 'WAREHOUSE_ADMIN')
  @Get()
  async list(
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('type') type?: string,
    @Query('status') status?: string,
    @Query('carrier') carrier?: string,
    @Query('customerId') customerId?: string,
  ) {
    const r = await this.svc.list({ page, pageSize, type, status, carrier, customerId });
    return ok(r.data, r.pagination);
  }

  @Roles('SUPER_ADMIN', 'FINANCE')
  @Post()
  async create(@Body() body: CreateRateCardDto) {
    return ok(await this.svc.create(body));
  }

  @Roles('SUPER_ADMIN', 'FINANCE', 'CUSTOMER_SERVICE', 'WAREHOUSE_ADMIN')
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return ok(await this.svc.findOne(id));
  }

  // Zones are paged separately: a SHIPPING card carries thousands of rows and
  // must not be inlined into the card detail response.
  @Roles('SUPER_ADMIN', 'FINANCE', 'CUSTOMER_SERVICE', 'WAREHOUSE_ADMIN')
  @Get(':id/zones')
  async listZones(
    @Param('id') id: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('zone') zone?: string,
    @Query('origin') origin?: string,
  ) {
    const r = await this.svc.listZones(id, { page, pageSize, zone, origin });
    return ok(r.data, r.pagination);
  }

  // Items are paged for the same reason zones are: a shipping card carries one
  // row per (zone × weight band), which runs to several thousand.
  @Roles('SUPER_ADMIN', 'FINANCE', 'CUSTOMER_SERVICE', 'WAREHOUSE_ADMIN')
  @Get(':id/items')
  async listItems(
    @Param('id') id: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('zone') zone?: string,
    @Query('itemCode') itemCode?: string,
  ) {
    const r = await this.svc.listItems(id, { page, pageSize, zone, itemCode });
    return ok(r.data, r.pagination);
  }

  @Roles('SUPER_ADMIN', 'FINANCE')
  @Post(':id/items')
  async addItems(@Param('id') id: string, @Body() body: AddRateCardItemsDto) {
    return ok(await this.svc.addItems(id, body));
  }

  @Roles('SUPER_ADMIN', 'FINANCE')
  @Post(':id/zones')
  async addZones(@Param('id') id: string, @Body() body: AddShippingZonesDto) {
    return ok(await this.svc.addZones(id, body));
  }

  @Roles('SUPER_ADMIN', 'FINANCE')
  @Put(':id/activate')
  async activate(@Param('id') id: string) {
    return ok(await this.svc.activate(id));
  }

  @Roles('SUPER_ADMIN', 'FINANCE')
  @Put(':id/archive')
  async archive(@Param('id') id: string) {
    return ok(await this.svc.archive(id));
  }
}
