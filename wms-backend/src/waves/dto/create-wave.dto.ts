import { ArrayMinSize, IsArray, IsIn, IsOptional, IsString } from 'class-validator';

/**
 * Create-wave DTO. A wave groups already-ALLOCATED outbound orders for batch picking.
 * `strategy` shapes the pick list: PICK_AND_PASS (摘果, per-order) | BATCH_SOW (播种, SKU-aggregated).
 */
export class CreateWaveDto {
  @IsString()
  warehouseId!: string;

  @IsOptional()
  @IsIn(['PICK_AND_PASS', 'BATCH_SOW'])
  strategy?: 'PICK_AND_PASS' | 'BATCH_SOW';

  @IsArray()
  @ArrayMinSize(1, { message: '波次至少包含 1 个出库单' })
  @IsString({ each: true })
  orderIds!: string[];
}
