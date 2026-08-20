import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ok } from '../common/api-response';
import { OutboundOrdersService } from './outbound-orders.service';
import { Roles } from '../common/decorators/roles.decorator';
import { CreateOutboundOrderDto } from './dto/create-outbound-order.dto';
import { BulkImportOutboundDto } from './dto/bulk-import-outbound.dto';
import { PickOutboundItemDto } from './dto/pick-outbound-item.dto';

@Controller()
export class OutboundOrdersController {
  constructor(private readonly svc: OutboundOrdersService) {}

  // ─── List ───────────────────────────────────────────────────────────

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR', 'CUSTOMER_SERVICE')
  @Get('outbound-orders')
  async list(
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('status') status?: string,
    @Query('channel') channel?: string,
  ) {
    const result = await this.svc.list({ page, pageSize, status, channel });
    return ok(result.data, result.pagination);
  }

  // ─── Detail ─────────────────────────────────────────────────────────

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR', 'CUSTOMER_SERVICE')
  @Get('outbound-orders/:id')
  async detail(@Param('id') id: string) {
    return ok(await this.svc.detail(id));
  }

  // ─── Create (建单) ──────────────────────────────────────────────────

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'CUSTOMER_SERVICE')
  @Post('outbound-orders')
  async create(@Body() body: CreateOutboundOrderDto) {
    return ok(await this.svc.create(body));
  }

  // ─── Bulk import (JSON 批量导入) ────────────────────────────────────

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'CUSTOMER_SERVICE')
  @Post('outbound-orders/bulk-import')
  async bulkImport(@Body() body: BulkImportOutboundDto) {
    return ok(await this.svc.bulkCreate(body.orders));
  }

  // ─── Action: 库存分配 ───────────────────────────────────────────────

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR')
  @Post('outbound-orders/:id/allocate')
  async allocate(@Param('id') id: string) {
    return ok(await this.svc.allocate(id));
  }

  // ─── Action: 开始拣货 ───────────────────────────────────────────────

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR')
  @Post('outbound-orders/:id/start-picking')
  async startPicking(@Param('id') id: string) {
    return ok(await this.svc.startPicking(id));
  }

  // ─── Action: 拣货登记 ───────────────────────────────────────────────

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR')
  @Post('outbound-orders/:id/pick')
  async pick(@Param('id') id: string, @Body() body: PickOutboundItemDto) {
    return ok(await this.svc.pick(id, body));
  }

  // ─── Action: 拣货完成 ───────────────────────────────────────────────

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR')
  @Post('outbound-orders/:id/complete-picking')
  async completePicking(@Param('id') id: string) {
    return ok(await this.svc.completePicking(id));
  }

  // ─── Action: 开始打包 ───────────────────────────────────────────────

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR')
  @Post('outbound-orders/:id/start-packing')
  async startPacking(@Param('id') id: string) {
    return ok(await this.svc.startPacking(id));
  }

  // ─── Action: 打包扫码 ───────────────────────────────────────────────

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR')
  @Post('outbound-orders/:id/pack')
  async pack(
    @Param('id') id: string,
    @Body() body: { sku: string; qty: number; boxNo?: string },
  ) {
    return ok(await this.svc.pack(id, body));
  }

  // ─── Action: 打包完成 ───────────────────────────────────────────────

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR')
  @Post('outbound-orders/:id/complete-packing')
  async completePacking(@Param('id') id: string) {
    return ok(await this.svc.completePacking(id));
  }

  // ─── Action: 签出发货 ───────────────────────────────────────────────

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR')
  @Post('outbound-orders/:id/ship')
  async ship(@Param('id') id: string) {
    return ok(await this.svc.ship(id));
  }

  // ─── Action: 物流确认 ───────────────────────────────────────────────

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN')
  @Post('outbound-orders/:id/sign')
  async sign(@Param('id') id: string) {
    return ok(await this.svc.sign(id));
  }

  // ─── Action: 标记异常 ───────────────────────────────────────────────

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR', 'CUSTOMER_SERVICE')
  @Post('outbound-orders/:id/exception')
  async markException(
    @Param('id') id: string,
    @Body() body: { type: string; reason?: string },
  ) {
    return ok(await this.svc.markException(id, body));
  }

  // ─── Action: 取消订单 ───────────────────────────────────────────────

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN')
  @Post('outbound-orders/:id/cancel')
  async cancel(@Param('id') id: string) {
    return ok(await this.svc.cancel(id));
  }

  // ─── Queries ────────────────────────────────────────────────────────

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR')
  @Get('picking-lists')
  async pickingLists() {
    return ok(await this.svc.pickingLists());
  }

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR', 'CUSTOMER_SERVICE')
  @Get('outbound-exceptions')
  async exceptions() {
    return ok(await this.svc.exceptions());
  }

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR')
  @Post('outbound-exceptions/:id/resolve')
  async resolveException(
    @Param('id') id: string,
    @Body() body: { resolution?: string },
  ) {
    return ok(await this.svc.resolveException(id, body ?? {}));
  }
}