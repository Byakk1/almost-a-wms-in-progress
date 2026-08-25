import { Type } from 'class-transformer';
import {
  ArrayNotEmpty, IsArray, IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber,
  IsOptional, IsString, Min, ValidateNested,
} from 'class-validator';

export class FeeItemDto {
  @IsString()
  @IsNotEmpty({ message: '商品 ID 不能为空（productId）' })
  productId!: string;

  @IsInt({ message: '数量必须为整数（qty）' })
  @Min(1, { message: '数量至少为 1' })
  qty!: number;
}

/**
 * Freight estimation input.
 *
 * TWO ways to state the parcel, because the calculator is used before an order
 * exists as often as after one:
 *   · `items`  — SKUs and quantities; weight and volume come from the products
 *   · direct   — actualWeightKg + optional dimensions, no SKU needed
 *
 * `items` wins when both are supplied. Neither is required at the DTO level —
 * FeeService raises the error, so the message can name both routes rather than
 * a single missing field.
 *
 * Replaces an inline body type on the controller that had NO validation at all:
 * with no DTO class the global ValidationPipe had nothing to check or whitelist,
 * so any shape reached the service.
 */
export class CalculateFeeDto {
  @IsOptional() @IsString()
  customerId?: string;

  @IsOptional() @IsString()
  warehouseId?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty({ message: '商品明细不能为空数组（items）' })
  @ValidateNested({ each: true })
  @Type(() => FeeItemDto)
  items?: FeeItemDto[];

  @IsOptional()
  @IsNumber({}, { message: '实重必须为数字（actualWeightKg）' })
  @Min(0, { message: '实重不能为负' })
  actualWeightKg?: number;

  @IsOptional()
  @IsNumber({}, { message: '长度必须为数字（length）' })
  @Min(0, { message: '长度不能为负' })
  length?: number;

  @IsOptional()
  @IsNumber({}, { message: '宽度必须为数字（width）' })
  @Min(0, { message: '宽度不能为负' })
  width?: number;

  @IsOptional()
  @IsNumber({}, { message: '高度必须为数字（height）' })
  @Min(0, { message: '高度不能为负' })
  height?: number;

  @IsOptional()
  @IsInt({ message: '件数必须为整数（pieces）' })
  @Min(1, { message: '件数至少为 1' })
  pieces?: number;

  @IsOptional()
  @IsIn(['AIR', 'SEA', 'EXPRESS'], { message: '运输方式无效，可选：AIR / SEA / EXPRESS' })
  shippingMode?: 'AIR' | 'SEA' | 'EXPRESS';

  @IsOptional() @IsString()
  destinationCountry?: string;

  /** Postcode — required to reach a real SHIPPING card (postcode → zone → band). */
  @IsOptional() @IsString()
  destination?: string;

  /** Carrier as it appears on the rate card header, e.g. CANADAPOST. */
  @IsOptional() @IsString()
  carrier?: string;

  /** Shipping warehouse as labelled in the carrier's zone table, e.g. 多伦多. */
  @IsOptional() @IsString()
  origin?: string;

  /** Quote as-of; lets a bill reprint at the prices that were live when issued. */
  @IsOptional()
  @IsDateString({}, { message: '计费时间格式无效（at）' })
  at?: string;
}
