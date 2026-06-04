import { Controller, Get, Query } from '@nestjs/common';
import { ok } from '../common/api-response';
import { DashboardService } from './dashboard.service';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR', 'CUSTOMER_SERVICE', 'FINANCE')
  @Get('stats')
  async stats() {
    return ok(await this.dashboardService.stats());
  }

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR', 'CUSTOMER_SERVICE', 'FINANCE')
  @Get('trend')
  async trend(@Query('days') days?: number) {
    return ok(await this.dashboardService.trend(days ?? 7));
  }

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR', 'CUSTOMER_SERVICE', 'FINANCE')
  @Get('todos')
  async todos() {
    return ok(await this.dashboardService.todos());
  }

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR', 'CUSTOMER_SERVICE', 'FINANCE')
  @Get('warehouse-utilization')
  async warehouseUtilization() {
    return ok(await this.dashboardService.warehouseUtilization());
  }
}