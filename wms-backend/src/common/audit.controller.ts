import { Controller, Get, Param, Query } from '@nestjs/common';
import { ok } from '../common/api-response';
import { OperationLogService } from '../common/operation-log.service';
import { InventoryTransactionService } from '../common/inventory-transaction.service';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('audit')
export class AuditController {
  constructor(
    private readonly opLog: OperationLogService,
    private readonly invTx: InventoryTransactionService,
  ) {}

  // ─── Operation Logs ─────────────────────────────────────────────────

  /** Get all operation logs for a specific entity (e.g. a receiving order) */
  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'CUSTOMER_SERVICE')
  @Get('operations/:entityType/:entityId')
  async operationsByEntity(
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ) {
    return ok(await this.opLog.listByEntity(entityType, entityId));
  }

  /** Get recent operations across all entities (admin audit view) */
  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN')
  @Get('operations')
  async recentOperations(
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    const result = await this.opLog.listRecent(
      Number(page ?? 1),
      Number(pageSize ?? 50),
    );
    return ok(result.data, result.pagination);
  }

  /** Get operations by a specific operator (for KPI) */
  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN')
  @Get('operations/operator/:operatorId')
  async operationsByOperator(
    @Param('operatorId') operatorId: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    const result = await this.opLog.listByOperator(
      operatorId,
      Number(page ?? 1),
      Number(pageSize ?? 50),
    );
    return ok(result.data, result.pagination);
  }

  // ─── Inventory Transactions ─────────────────────────────────────────

  /** Get inventory transaction history for a product in a warehouse */
  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR', 'CUSTOMER_SERVICE')
  @Get('inventory-transactions')
  async inventoryTransactions(
    @Query('warehouseId') warehouseId: string,
    @Query('productId') productId: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    const result = await this.invTx.listByProduct({
      warehouseId,
      productId,
      page: Number(page ?? 1),
      pageSize: Number(pageSize ?? 20),
    });
    return ok(result.data, result.pagination);
  }

  /** Get inventory transactions linked to a specific document */
  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR', 'CUSTOMER_SERVICE')
  @Get('inventory-transactions/:refType/:refId')
  async inventoryTransactionsByRef(
    @Param('refType') refType: string,
    @Param('refId') refId: string,
  ) {
    return ok(await this.invTx.listByRef(refType, refId));
  }

  /** Get inventory transactions for a specific location */
  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR')
  @Get('inventory-transactions/location/:locationId')
  async inventoryTransactionsByLocation(
    @Param('locationId') locationId: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    const result = await this.invTx.listByLocation(
      locationId,
      Number(page ?? 1),
      Number(pageSize ?? 20),
    );
    return ok(result.data, result.pagination);
  }
}
