import {
  IsBoolean, IsDateString, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString,
  Matches, MaxLength, Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Mirrors the `calcType` comment on `model Surcharge` — the DTO must never accept a
 * type the charge engine (charge-calculator) doesn't know how to apply.
 *
 *   FLAT             fixed amount per shipment (value = amount)
 *   PERCENT_OF_BASE  percentage of the base charge (value = percent, 12.5 means 12.5 %)
 *   PASS_THROUGH     carrier-billed, amount unknown until finalize — carries NO value
 */
export const CALC_TYPES = ['FLAT', 'PERCENT_OF_BASE', 'PASS_THROUGH'] as const;
export type CalcTypeValue = (typeof CALC_TYPES)[number];

/** Which base lines the surcharge attaches to. */
export const APPLIES_TO = ['SHIPPING', 'HANDLING', 'ALL'] as const;
export type AppliesToValue = (typeof APPLIES_TO)[number];

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/**
 * Body for POST /surcharges.
 *
 * `code` and `calcType` are fixed at creation: a surcharge that changes its nature is a
 * NEW code, so a bill generated last month still reproduces against the definition
 * that applied then.
 */
export class CreateSurchargeDto {
  /** Stable key, stored upper-case ('FUEL', 'RESIDENTIAL'). */
  @Transform(upper)
  @IsString()
  @Matches(/^[A-Z0-9_]{2,32}$/, { message: '附加费代码须为 2–32 位大写字母/数字/下划线（code）' })
  code!: string;

  @IsString()
  @IsNotEmpty({ message: '附加费名称不能为空（name）' })
  @MaxLength(100)
  name!: string;

  @Transform(upper)
  @IsIn(CALC_TYPES, { message: `计算方式必须是 ${CALC_TYPES.join(' / ')} 之一（calcType）` })
  calcType!: CalcTypeValue;

  /** Required for FLAT / PERCENT_OF_BASE, forbidden for PASS_THROUGH — enforced in the service. */
  @IsOptional()
  @IsNumber({}, { message: '金额/比例必须为数字（value）' })
  @Min(0, { message: '金额/比例不能为负' })
  value?: number | null;

  /** Default true: most surcharges are part of the taxable base. */
  @IsOptional() @IsBoolean()
  taxable?: boolean;

  /** NULL = applies to every carrier. */
  @IsOptional() @IsString() @MaxLength(64)
  carrier?: string | null;

  @IsOptional()
  @Transform(upper)
  @IsIn(APPLIES_TO, { message: `适用范围必须是 ${APPLIES_TO.join(' / ')} 之一（appliesTo）` })
  appliesTo?: AppliesToValue;

  @IsOptional() @IsString() @MaxLength(500)
  note?: string | null;

  @IsDateString({}, { message: '生效日期格式无效（effectiveFrom）' })
  effectiveFrom!: string;

  @IsOptional()
  @IsDateString({}, { message: '失效日期格式无效（effectiveTo）' })
  effectiveTo?: string | null;
}

/**
 * Body for PUT /surcharges/:id — only the mutable fields. `code`, `calcType` and
 * `effectiveFrom` are deliberately absent: changing identity would rewrite history for
 * bills already generated against this row.
 */
export class UpdateSurchargeDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: '附加费名称不能为空（name）' })
  @MaxLength(100)
  name?: string;

  /** Re-validated against the row's calcType in the service. Pass null to clear. */
  @IsOptional()
  @IsNumber({}, { message: '金额/比例必须为数字（value）' })
  @Min(0, { message: '金额/比例不能为负' })
  value?: number | null;

  @IsOptional() @IsBoolean()
  taxable?: boolean;

  @IsOptional() @IsString() @MaxLength(64)
  carrier?: string | null;

  @IsOptional()
  @Transform(upper)
  @IsIn(APPLIES_TO, { message: `适用范围必须是 ${APPLIES_TO.join(' / ')} 之一（appliesTo）` })
  appliesTo?: AppliesToValue;

  @IsOptional() @IsString() @MaxLength(500)
  note?: string | null;

  /** Pass null to re-open the window (clear the end date). */
  @IsOptional()
  @IsDateString({}, { message: '失效日期格式无效（effectiveTo）' })
  effectiveTo?: string | null;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class ListSurchargesQueryDto {
  @IsOptional() @Transform(upper) @IsString() code?: string;
  @IsOptional() @Transform(upper) @IsIn(CALC_TYPES) calcType?: CalcTypeValue;
  /** Arrives as a query string; "true"/"false" only. */
  @IsOptional() @IsIn(['true', 'false']) isActive?: 'true' | 'false';
  @IsOptional() @IsString() carrier?: string;
  @IsOptional() page?: number;
  @IsOptional() pageSize?: number;
}
