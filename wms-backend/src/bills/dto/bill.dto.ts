import {
  ArrayMaxSize, IsArray, IsIn, IsNotEmpty, IsNumber, IsOptional, IsString,
  Matches, Min, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Confirmation codes a FINANCE user can supply at finalize to clear a review flag.
 * Each one maps to exactly one warning the engine raises; the engine refuses to
 * clear a flag that was not explicitly confirmed (PRD §10 decision 2 / §5.2).
 */
export const CONFIRMATION_CODES = ['EXPORT_ZERO_RATED', 'TAX_REVIEW_ACCEPTED'] as const;
export type ConfirmationCode = (typeof CONFIRMATION_CODES)[number];

/** A carrier-invoiced amount for a PASS_THROUGH surcharge (e.g. FUEL). */
export class ActualDto {
  @IsString()
  @IsNotEmpty({ message: '附加费代码不能为空（code）' })
  code!: string;

  @IsNumber({}, { message: '实报实销金额必须为数字（amount）' })
  @Min(0, { message: '实报实销金额不能为负' })
  amount!: number;
}

export class GenerateBillDto {
  @IsString()
  @IsNotEmpty({ message: '客户不能为空（customerId）' })
  customerId!: string;

  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: '账期格式应为 YYYY-MM（period）' })
  period!: string;

  /** Optional: carrier actuals already in hand at generation time. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ActualDto)
  actuals?: ActualDto[];

  @IsOptional()
  @IsArray()
  @IsIn(CONFIRMATION_CODES, { each: true, message: `确认码必须是 ${CONFIRMATION_CODES.join(' / ')} 之一` })
  confirmations?: ConfirmationCode[];
}

export class FinalizeBillDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ActualDto)
  actuals?: ActualDto[];

  @IsOptional()
  @IsArray()
  @IsIn(CONFIRMATION_CODES, { each: true, message: `确认码必须是 ${CONFIRMATION_CODES.join(' / ')} 之一` })
  confirmations?: ConfirmationCode[];
}

export class ListBillsQueryDto {
  @IsOptional() @IsString() customerId?: string;

  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: '账期格式应为 YYYY-MM（period）' })
  period?: string;

  @IsOptional() @IsIn(['unpaid', 'paid']) status?: 'unpaid' | 'paid';

  /** Query strings arrive as text; parsed in the service. */
  @IsOptional() @IsIn(['true', 'false']) isProvisional?: 'true' | 'false';

  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() pageSize?: string;
}
