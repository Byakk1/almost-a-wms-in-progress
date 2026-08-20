import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsDateString, IsIn, IsNotEmpty, IsNumber,
  IsOptional, IsString, Min, ValidateNested,
} from 'class-validator';
import { CHARGE_UNITS, RATE_CARD_TYPES, TIER_BASES } from '../rate-card.constants';

/**
 * One priced line. Two shapes share this DTO:
 *   · a TIER band  — tierBasis != NONE, rangeStart/rangeEnd carry the band
 *   · a FLAT service — tierBasis NONE, itemCode/itemName carry the identity
 *
 * unitPrice is optional ONLY when quoteOnRequest is true (面议 / 详细请咨询客服);
 * RateCardsService.create rejects the combination where both are absent, because
 * a missing price must never silently bill as zero.
 */
export class RateCardItemDto {
  @IsOptional() @IsString()
  itemCode?: string;

  @IsOptional() @IsString()
  itemName?: string;

  @IsOptional() @IsString()
  zone?: string; // SHIPPING only

  @IsOptional()
  @IsIn(TIER_BASES as unknown as string[], {
    message: `梯度基准无效，可选：${TIER_BASES.join(' / ')}`,
  })
  tierBasis?: string;

  @IsOptional()
  @IsNumber({}, { message: '梯度起点必须为数字（rangeStart）' })
  @Min(0, { message: '梯度起点不能为负' })
  rangeStart?: number; // inclusive; omit = 0

  @IsOptional()
  @IsNumber({}, { message: '梯度终点必须为数字（rangeEnd）' })
  @Min(0, { message: '梯度终点不能为负' })
  rangeEnd?: number; // exclusive; omit = infinity

  @IsIn(CHARGE_UNITS as unknown as string[], {
    message: `计费单位无效，可选：${CHARGE_UNITS.join(' / ')}`,
  })
  chargeUnit!: string;

  @IsOptional()
  @IsNumber({}, { message: '单价必须为数字（unitPrice）' })
  @Min(0, { message: '单价不能为负' })
  unitPrice?: number;

  @IsOptional()
  @IsNumber({}, { message: '最低收费必须为数字（minFee）' })
  @Min(0, { message: '最低收费不能为负' })
  minFee?: number;

  @IsOptional() @IsBoolean()
  quoteOnRequest?: boolean;

  @IsOptional() @IsString()
  note?: string;
}

/** postcode prefix → zone, for SHIPPING cards. Longest prefix wins at lookup. */
export class ShippingZoneDto {
  @IsString()
  @IsNotEmpty({ message: '目的地前缀不能为空（destination）' })
  destination!: string;

  @IsString()
  @IsNotEmpty({ message: '分区不能为空（zone）' })
  zone!: string;
}

/** Creates a card in DRAFT. Items may be supplied inline or added later. */
export class CreateRateCardDto {
  @IsString()
  @IsNotEmpty({ message: '价卡名称不能为空（name）' })
  name!: string;

  @IsIn(RATE_CARD_TYPES as unknown as string[], {
    message: `价卡类型无效，可选：${RATE_CARD_TYPES.join(' / ')}`,
  })
  type!: string;

  @IsOptional() @IsString()
  carrier?: string; // SHIPPING only

  @IsOptional() @IsString()
  currency?: string;

  @IsOptional() @IsBoolean()
  isDefault?: boolean;

  @IsDateString({}, { message: '生效时间格式无效（effectiveAt）' })
  effectiveAt!: string;

  @IsOptional()
  @IsDateString({}, { message: '失效时间格式无效（expiredAt）' })
  expiredAt?: string;

  @IsOptional() @IsString()
  note?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RateCardItemDto)
  items?: RateCardItemDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShippingZoneDto)
  zones?: ShippingZoneDto[];
}
