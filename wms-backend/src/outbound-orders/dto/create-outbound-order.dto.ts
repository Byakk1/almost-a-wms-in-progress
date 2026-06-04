import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Outbound-order create DTO — accepts the descriptive fulfillment fields supplied
 * by the customer/source at order placement (report v4.8 field set).
 *
 * Deliberately EXCLUDED (owned by the state machine / workflow actions, not create):
 *   status, serviceUpdated, submittedAt, shippedAt, cancelledAt, exceptionReason, cancelResult.
 *
 * Note: the global ValidationPipe runs with `whitelist: true`, so any field NOT
 * declared here is silently stripped before it reaches the service.
 */
export class CreateOutboundItemDto {
  @IsString()
  productId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1, { message: '需求数量必须 ≥ 1' })
  requiredQty!: number;
}

export class CreateOutboundOrderDto {
  // ─── Owner / Warehouse (required relations) ──────────
  @IsString()
  customerId!: string;

  @IsString()
  warehouseId!: string;

  // ─── Shipper / Service ───────────────────────────────
  @IsOptional() @IsString() shipperId?: string;
  @IsOptional() @IsString() shipperNameZh?: string;
  @IsOptional() @IsString() shipperNameEn?: string;
  @IsOptional() @IsString() serviceName?: string;
  @IsOptional() @IsBoolean() serviceLocked?: boolean;

  // ─── References / Source ─────────────────────────────
  @IsOptional() @IsString() customerRef?: string;
  @IsOptional() @IsString() platformRef?: string;
  @IsOptional() @IsString() platformCode?: string;
  @IsOptional() @IsString() orderSource?: string;
  @IsOptional() @IsString() creator?: string;
  @IsOptional() @IsString() inboundOrderNo?: string;
  @IsOptional() @IsString() inboundContainerNo?: string;

  // ─── Tracking / Carrier ──────────────────────────────
  @IsOptional() @IsString() trackingNo?: string;
  @IsOptional() @IsString() trackingNo1?: string;
  @IsOptional() @IsString() trackingTrace?: string;
  @IsOptional() @IsString() trackingTrace1?: string;
  @IsOptional() @IsString() carrier?: string;
  @IsOptional() @IsBoolean() multiPackage?: boolean;

  // ─── Recipient (ship-to) ─────────────────────────────
  @IsOptional() @IsString() recipientName?: string;
  @IsOptional() @IsString() recipientCompany?: string;
  @IsOptional() @IsString() recipientPhone?: string;
  @IsOptional() @IsString() recipientEmail?: string;
  @IsOptional() @IsString() recipientZip?: string;
  @IsOptional() @IsString() recipientCountry?: string;
  @IsOptional() @IsString() recipientProvince?: string;
  @IsOptional() @IsString() recipientCity?: string;
  @IsOptional() @IsString() recipientDistrict?: string;
  @IsOptional() @IsString() recipientAddress1?: string;
  @IsOptional() @IsString() recipientAddress2?: string;
  @IsOptional() @IsString() recipientAddress3?: string;
  @IsOptional() @IsString() shipToCode?: string;
  @IsOptional() @IsString() addressType?: string;
  @IsOptional() @IsString() remark?: string;

  // ─── Charges ─────────────────────────────────────────
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) transactionAmount?: number;
  @IsOptional() @IsString() transactionCurrency?: string;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) fee?: number;

  // ─── Weights / Volume / Package ──────────────────────
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) totalWeightKg?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) totalVolumeCbm?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 1 }) @Min(0) packageLength?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 1 }) @Min(0) packageWidth?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 1 }) @Min(0) packageHeight?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) packageActualWeight?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 3 }) @Min(0) packageBillingWeight?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) packageActualVolume?: number;

  // ─── Picking ─────────────────────────────────────────
  @IsOptional() @IsString() pickingType?: string;

  // ─── Line items (required, ≥ 1) ──────────────────────
  @IsArray()
  @ArrayMinSize(1, { message: '出库单至少包含 1 个明细行' })
  @ValidateNested({ each: true })
  @Type(() => CreateOutboundItemDto)
  items!: CreateOutboundItemDto[];
}
