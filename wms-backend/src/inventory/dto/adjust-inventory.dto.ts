import { IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * Inventory adjust DTO. Manually nudges on-hand stock for one SKU at one location.
 *
 * `deltaQty` may be negative (decrement) but must be a finite integer — the qty
 * columns are Prisma `Int`. `@IsInt` rejects NaN / Infinity / non-integers, which
 * retires the previous hand-rolled `Number.isFinite` guard in the service. The
 * service still enforces the business rule that available/total may not go below 0.
 */
export class AdjustInventoryDto {
  @IsString()
  @IsNotEmpty()
  sku!: string;

  @IsString()
  @IsNotEmpty()
  locationCode!: string;

  @IsInt({ message: '调整数量必须为整数（deltaQty）' })
  deltaQty!: number;

  @IsOptional()
  @IsString()
  reason?: string;
}
