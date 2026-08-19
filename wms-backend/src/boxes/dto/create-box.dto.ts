import { IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

/**
 * Create boxes against a transit order. Boxes start at PENDING and are given an
 * auto-generated per-day boxNo (BOX-YYMMDD-NNNN), so callers never supply one.
 *
 * `count` exists because cartons are created in batches at packing time — one
 * request per carton would be pure overhead for the caller.
 */
export class CreateBoxDto {
  @IsString()
  @IsNotEmpty({ message: '中转单 ID 不能为空（transitOrderId）' })
  transitOrderId!: string;

  @IsOptional()
  @IsInt({ message: '箱数必须为整数（count）' })
  @Min(1, { message: '箱数至少为 1' })
  count?: number;

  @IsOptional()
  @IsInt({ message: '件数必须为整数（pieces）' })
  @Min(0, { message: '件数不能为负' })
  pieces?: number;

  @IsOptional()
  @IsString()
  destination?: string;

  @IsOptional()
  @IsString()
  courier?: string;
}
