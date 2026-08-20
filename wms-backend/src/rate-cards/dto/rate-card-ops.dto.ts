import { Type } from 'class-transformer';
import {
  IsArray, IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber,
  IsOptional, IsString, Max, Min, ValidateNested,
} from 'class-validator';
import {
  MAX_DISCOUNT_RATIO, MIN_DISCOUNT_RATIO, RATE_CARD_TYPES, TIER_BASES,
} from '../rate-card.constants';
import { RateCardItemDto, ShippingZoneDto } from './create-rate-card.dto';

/** Append lines to a DRAFT card. Rejected once the card is ACTIVE. */
export class AddRateCardItemsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RateCardItemDto)
  items!: RateCardItemDto[];
}

/** Append postcode→zone rows to a DRAFT SHIPPING card. */
export class AddShippingZonesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ShippingZoneDto)
  zones!: ShippingZoneDto[];
}

/** Bind a customer to a card. Higher priority wins when several match. */
export class AssignRateCardDto {
  @IsString()
  @IsNotEmpty({ message: '客户 ID 不能为空（customerId）' })
  customerId!: string;

  @IsString()
  @IsNotEmpty({ message: '价卡 ID 不能为空（rateCardId）' })
  rateCardId!: string;

  @IsOptional()
  @IsInt({ message: '优先级必须为整数（priority）' })
  priority?: number;

  /**
   * Negotiated contract multiplier. 1 = list price, 0.7 = the hard floor (30% off).
   * Out-of-range values are REFUSED rather than clamped: silently pulling a 0.5 up
   * to 0.7 would bill at a rate nobody agreed to and hide the misconfiguration.
   */
  @IsOptional()
  @IsNumber({}, { message: '折扣系数必须为数字（discountRatio）' })
  @Min(MIN_DISCOUNT_RATIO, {
    message: `折扣系数不得低于 ${MIN_DISCOUNT_RATIO}（最多 ${Math.round((1 - MIN_DISCOUNT_RATIO) * 100)}% 折让）`,
  })
  @Max(MAX_DISCOUNT_RATIO, { message: `折扣系数不得高于 ${MAX_DISCOUNT_RATIO}（不得高于标准价）` })
  discountRatio?: number;
}

/**
 * Ask the engine what something costs.
 *
 * `value` is the number the TIER is matched against, in tierBasis units
 * (kg for WEIGHT_KG, days for STORAGE_DAYS…). `quantity` is what the matched
 * unitPrice is multiplied by. They are separate because the two are often
 * different numbers: a 3.4 kg parcel matches the 3–4 kg band, but if that band
 * is priced PER_ORDER the quantity is 1, not 3.4.
 */
export class QuoteDto {
  @IsOptional() @IsString()
  customerId?: string; // omit → the default (list price) card

  @IsIn(RATE_CARD_TYPES as unknown as string[], {
    message: `价卡类型无效，可选：${RATE_CARD_TYPES.join(' / ')}`,
  })
  type!: string;

  @IsOptional() @IsString()
  carrier?: string;

  @IsOptional() @IsString()
  itemCode?: string; // required to disambiguate EXTRA / multi-service cards

  @IsOptional() @IsString()
  destination?: string; // SHIPPING: postcode, resolved to a zone

  @IsOptional() @IsString()
  origin?: string; // SHIPPING: shipping warehouse — same postcode, different zone

  @IsOptional()
  @IsIn(TIER_BASES as unknown as string[], {
    message: `梯度基准无效，可选：${TIER_BASES.join(' / ')}`,
  })
  tierBasis?: string;

  @IsOptional()
  @IsNumber({}, { message: '计费数值必须为数字（value）' })
  @Min(0, { message: '计费数值不能为负' })
  value?: number;

  @IsOptional()
  @IsNumber({}, { message: '数量必须为数字（quantity）' })
  @Min(0, { message: '数量不能为负' })
  quantity?: number; // default 1

  @IsOptional()
  @IsDateString({}, { message: '计费时间格式无效（at）' })
  at?: string; // default now — lets a bill reprint at its original prices
}
