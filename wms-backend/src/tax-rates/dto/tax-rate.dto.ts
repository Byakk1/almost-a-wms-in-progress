import {
  IsBoolean, IsDateString, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString,
  Length, Matches, Max, MaxLength, Min,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Mirrors the `taxType` comment on `model TaxRate` — the DTO must never accept a
 * type the tax engine (charge-calculator) doesn't know how to apply.
 *
 * EXPORT is the zero-rated row for non-CA destinations (PRD §10 decision 2); it is
 * seeded per country with `jurisdiction = countryCode` and lives in the same table so
 * the accountant can add a country without a deploy.
 */
export const TAX_TYPES = ['GST', 'HST', 'PST', 'QST', 'EXPORT'] as const;
export type TaxTypeValue = (typeof TAX_TYPES)[number];

const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

/**
 * Body for POST /tax-rates.
 *
 * Identity fields (countryCode, jurisdiction, taxType, effectiveFrom) are fixed at
 * creation: a rate change is a NEW row with a later effectiveFrom, and the old row is
 * end-dated via PUT. That keeps every historical bill reproducible against the rate
 * that applied on its shipped date.
 */
export class CreateTaxRateDto {
  /** ISO 3166-1 alpha-2, stored upper-case ('CA', 'AU'). */
  @Transform(upper)
  @IsString()
  @Length(2, 2, { message: '国家代码必须是 2 位字母（countryCode）' })
  @Matches(/^[A-Z]{2}$/, { message: '国家代码必须是 2 位字母（countryCode）' })
  countryCode!: string;

  /** Canonical province/state code ('ON', 'NSW'); for EXPORT rows, the country code. */
  @Transform(upper)
  @IsString()
  @IsNotEmpty({ message: '税务辖区不能为空（jurisdiction）' })
  @MaxLength(16)
  jurisdiction!: string;

  @Transform(upper)
  @IsIn(TAX_TYPES, { message: `税种必须是 ${TAX_TYPES.join(' / ')} 之一（taxType）` })
  taxType!: TaxTypeValue;

  /** Percentage, not a fraction: 13 means 13 %. DECIMAL(6,3) in the DB. */
  @IsNumber({}, { message: '税率必须为数字（ratePercent）' })
  @Min(0, { message: '税率不能为负' })
  @Max(100, { message: '税率不能超过 100%' })
  ratePercent!: number;

  @IsDateString({}, { message: '生效日期格式无效（effectiveFrom）' })
  effectiveFrom!: string;

  @IsOptional()
  @IsDateString({}, { message: '失效日期格式无效（effectiveTo）' })
  effectiveTo?: string | null;

  @IsOptional() @IsString() @MaxLength(500)
  note?: string | null;
}

/**
 * Body for PUT /tax-rates/:id — only the mutable fields. countryCode / jurisdiction /
 * taxType / effectiveFrom are deliberately absent: changing identity would rewrite
 * history for bills already generated against this row.
 */
export class UpdateTaxRateDto {
  @IsOptional()
  @IsNumber({}, { message: '税率必须为数字（ratePercent）' })
  @Min(0, { message: '税率不能为负' })
  @Max(100, { message: '税率不能超过 100%' })
  ratePercent?: number;

  /** Pass null to re-open the window (clear the end date). */
  @IsOptional()
  @IsDateString({}, { message: '失效日期格式无效（effectiveTo）' })
  effectiveTo?: string | null;

  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @IsOptional() @IsString() @MaxLength(500)
  note?: string | null;
}

export class ListTaxRatesQueryDto {
  @IsOptional() @Transform(upper) @IsString() countryCode?: string;
  @IsOptional() @Transform(upper) @IsString() jurisdiction?: string;
  @IsOptional() @Transform(upper) @IsIn(TAX_TYPES) taxType?: TaxTypeValue;
  /** Arrives as a query string; "true"/"false" only. */
  @IsOptional() @IsIn(['true', 'false']) isActive?: 'true' | 'false';
  @IsOptional() page?: number;
  @IsOptional() pageSize?: number;
}
