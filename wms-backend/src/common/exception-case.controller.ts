import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import { ExceptionCaseService } from './exception-case.service';
import { ok } from './api-response';
import { Roles } from './decorators/roles.decorator';

@Controller('exceptions')
export class ExceptionCaseController {
  constructor(private readonly exceptionService: ExceptionCaseService) {}

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR', 'CUSTOMER_SERVICE')
  @Post()
  async create(
    @Body()
    body: {
      entityType: string;
      entityId: string;
      entityNo?: string;
      type: string;
      severity?: string;
      title: string;
      description?: string;
      warehouseId?: string;
      customerId?: string;
      productId?: string;
      locationId?: string;
      attachments?: string[];
      createdBy?: string;
    },
  ) {
    const result = await this.exceptionService.create(body);
    return ok(result);
  }

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR', 'CUSTOMER_SERVICE')
  @Get()
  async list(
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
    @Query('status') status?: string,
    @Query('entityType') entityType?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('type') type?: string,
  ) {
    const result = await this.exceptionService.list({
      page: page ? +page : undefined,
      pageSize: pageSize ? +pageSize : undefined,
      status,
      entityType,
      warehouseId,
      type,
    });
    // Normalize to the standard { data, pagination } envelope used by every other list
    // endpoint (receiving-orders, audit, products, …) so the frontend reads res.data / res.pagination.
    return ok(result.data, {
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
    });
  }

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR', 'CUSTOMER_SERVICE')
  @Get('stats')
  async stats(@Query('warehouseId') warehouseId?: string) {
    const result = await this.exceptionService.stats(warehouseId);
    return ok(result);
  }

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR', 'CUSTOMER_SERVICE')
  @Get('by-entity/:entityType/:entityId')
  async findByEntity(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ) {
    const result = await this.exceptionService.findByEntity(entityType, entityId);
    return ok(result);
  }

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR', 'CUSTOMER_SERVICE')
  @Get(':id')
  async detail(@Param('id') id: string) {
    const result = await this.exceptionService.detail(id);
    return ok(result);
  }

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR')
  @Post(':id/start')
  async startProcessing(
    @Param('id') id: string,
    @Body('operatorId') operatorId?: string,
  ) {
    const result = await this.exceptionService.startProcessing(id, operatorId);
    return ok(result);
  }

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR')
  @Post(':id/resolve')
  async resolve(
    @Param('id') id: string,
    @Body() body: { resolution: string; resolvedBy?: string },
  ) {
    const result = await this.exceptionService.resolve(id, body);
    return ok(result);
  }

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN')
  @Post(':id/close')
  async close(
    @Param('id') id: string,
    @Body('operatorId') operatorId?: string,
  ) {
    const result = await this.exceptionService.close(id, operatorId);
    return ok(result);
  }

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN')
  @Post(':id/cancel')
  async cancel(
    @Param('id') id: string,
    @Body('operatorId') operatorId?: string,
  ) {
    const result = await this.exceptionService.cancel(id, operatorId);
    return ok(result);
  }
}
