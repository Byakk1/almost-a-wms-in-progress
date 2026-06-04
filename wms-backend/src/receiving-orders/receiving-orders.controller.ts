import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ok } from '../common/api-response';
import { ReceivingOrdersService } from './receiving-orders.service';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('receiving-orders')
export class ReceivingOrdersController {
  constructor(private readonly svc: ReceivingOrdersService) {}

  // ─── List ───────────────────────────────────────────────────────────

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR', 'CUSTOMER_SERVICE')
  @Get()
  async list(
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('status') status?: string,
    @Query('customerName') customerName?: string,
  ) {
    const result = await this.svc.list({ page, pageSize, status: status as any, customerName });
    return ok(result.data, result.pagination);
  }

  // ─── Create ─────────────────────────────────────────────────────────

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'CUSTOMER_SERVICE')
  @Post()
  async create(
    @Body() body: {
      customerId: string;
      warehouseId: string;
      trackingNo?: string;
      expectedQuantity: number;
      items?: Array<{ productId: string; expectedQty: number }>;
    },
  ) {
    return ok(await this.svc.create(body));
  }

  // ─── Detail ─────────────────────────────────────────────────────────

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR', 'CUSTOMER_SERVICE')
  @Get(':id')
  async detail(@Param('id') id: string) {
    return ok(await this.svc.detail(id));
  }

  // ─── Action: 到仓扫描 ───────────────────────────────────────────────

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR')
  @Post(':id/arrive')
  async arrive(@Param('id') id: string) {
    return ok(await this.svc.arrive(id));
  }

  // ─── Action: 开始验收 ───────────────────────────────────────────────

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR')
  @Post(':id/check')
  async startChecking(@Param('id') id: string) {
    return ok(await this.svc.startChecking(id));
  }

  // ─── Action: 扫码收货 ───────────────────────────────────────────────

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR')
  @Post(':id/receive')
  async receive(
    @Param('id') id: string,
    @Body() body: { sku: string; qty: number; locationId?: string },
  ) {
    return ok(await this.svc.receive(id, body));
  }

  // ─── Action: 完成收货（→ 自动推送上架任务） ──────────────────────────

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR')
  @Post(':id/complete')
  async complete(@Param('id') id: string) {
    return ok(await this.svc.complete(id));
  }

  // ─── Action: 标记异常 ───────────────────────────────────────────────

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR', 'CUSTOMER_SERVICE')
  @Post(':id/exception')
  async markException(@Param('id') id: string, @Body() body: { reason: string }) {
    return ok(await this.svc.markException(id, body));
  }

  // ─── Action: 关闭异常 ───────────────────────────────────────────────

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN')
  @Post(':id/close-exception')
  async closeException(@Param('id') id: string) {
    return ok(await this.svc.closeException(id));
  }
}