import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { BatteryDto } from './battery.dto';

/**
 * Product create DTO — mirrors fields & rules from
 * 海外仓商品库上传模板V2.xlsx (52 fields).
 *
 * The template marks ~22 fields as required (*). For backwards-compatibility
 * with already-stored rows and partial drafts, this DTO keeps them optional
 * at the type level; the **service layer** enforces the conditional rules
 * (battery / hazardous / required-when-finalized).
 */
export class CreateProductDto {
  // ─── Identity ────────────────────────────────────
  @IsString()
  @MaxLength(30, { message: 'SKU 编码 最长 30 字符' })
  sku!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  barcode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string; // legacy/display, auto-filled if missing

  @IsOptional()
  @IsString()
  @MaxLength(255)
  nameZh?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  nameEn?: string;

  @IsString()
  customerId!: string;

  @IsOptional()
  @IsString()
  customerName?: string; // ignored on write; kept for round-tripping

  // ─── Dimensions & Weight ─────────────────────────
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  weight?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  weightUnit?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  length?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  width?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  height?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2)
  dimensionUnit?: string;

  // ─── Trade & Customs ─────────────────────────────
  @IsOptional()
  @IsString()
  @MaxLength(20)
  hsCode?: string;

  @IsOptional()
  @IsString()
  @Length(2, 3, { message: '原产国必须是 2-3 位国家代码' })
  @Matches(/^[A-Za-z]{2,3}$/)
  originCountry?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  declaredValue?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  actualValue?: number;

  @IsOptional()
  @IsString()
  @Length(3, 3, { message: '币种必须是 3 位字符' })
  @Matches(/^[A-Za-z]{3}$/)
  currency?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  material?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  usage?: string;

  // ─── Supply Chain ────────────────────────────────
  @IsOptional()
  @IsString()
  @MaxLength(50)
  brand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  supplier?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  itemType?: string;

  @IsOptional()
  @IsBoolean()
  hasShippingBag?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  packagingAttr?: string;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  salesUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  catalogue?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  warehouseCodes?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remark?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  // ─── Regulatory & Compliance ─────────────────────
  @IsOptional()
  @IsString()
  @MaxLength(50)
  batteryConfig?: string; // 不含电池 | 内置电池 | 配套电池 | 纯电池

  @IsOptional()
  @IsString()
  @MaxLength(255)
  otherAttrs?: string;

  @IsOptional()
  @IsBoolean()
  isHazardous?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  hazardCode?: string;

  @IsOptional()
  @IsBoolean()
  prop65?: boolean;

  @IsOptional()
  @IsBoolean()
  isFood?: boolean;

  @IsOptional()
  @IsBoolean()
  isRefrigerated?: boolean;

  @IsOptional()
  @IsBoolean()
  hasSerialNumber?: boolean;

  @IsOptional()
  @IsBoolean()
  isLotControlled?: boolean;

  // ─── Battery sub-table ───────────────────────────
  @IsOptional()
  @ValidateNested()
  @Type(() => BatteryDto)
  battery?: BatteryDto;
}
