import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Body for POST /outbound-orders/:id/pick — records that `qty` units of `sku` were
 * physically picked for this order.
 *
 * Mirrors the receiving side's scan contract (`{ sku, qty }`): quantities accumulate
 * server-side and the over-pick guard lives in the service, so a client cannot set
 * pickedQty directly.
 */
export class PickOutboundItemDto {
  @IsString()
  @IsNotEmpty({ message: 'sku 不能为空' })
  sku!: string;

  @Type(() => Number)
  @IsInt({ message: '拣货数量必须为整数' })
  @Min(1, { message: '拣货数量必须 ≥ 1' })
  qty!: number;
}
