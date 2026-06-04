import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { CreateOutboundOrderDto } from './create-outbound-order.dto';

/**
 * Bulk (JSON) import wrapper — a batch of independent outbound orders.
 * Unlike the Product bulk import (single customerId for all rows), each order
 * carries its own customerId, so orders may span customers.
 */
export class BulkImportOutboundDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOutboundOrderDto)
  orders!: CreateOutboundOrderDto[];
}
