import { Type } from 'class-transformer';
import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class BatteryDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  batteryType?: string; // 电池类型 (dictionary BATTERY_TYPE)

  @IsOptional()
  @IsString()
  @MaxLength(20)
  cellOrPack?: string; // 电池芯/电池组

  @IsOptional()
  @IsString()
  @MaxLength(50)
  batteryModel?: string; // 电池型号

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99999)
  quantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99999.99)
  weightGrams?: number; // 单个电池重量(g)

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99999.99)
  capacityMah?: number; // 单个电池安时额定值(mAh)

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99999.99)
  voltageV?: number; // 单个电池额定电压(V)

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  lithiumContentG?: number; // 单个电池锂含量(g)

  @IsOptional()
  @IsString()
  @MaxLength(50)
  packageMaterial?: string; // 电池包装材质

  @IsOptional()
  @IsString()
  @MaxLength(50)
  packaging?: string; // 电池包装

  @IsOptional()
  @IsString()
  @MaxLength(50)
  chargeStatus?: string; // 电池充电状态

  @IsOptional()
  @IsString()
  @MaxLength(255)
  otherDesc?: string; // 其他电池属性

  @IsOptional()
  @IsString()
  @MaxLength(50)
  carryingLabel?: string; // 商品携带标签

  @IsOptional()
  @IsString()
  @MaxLength(20)
  unCode?: string; // UN编码 e.g. UN3480

  @IsOptional()
  @IsString()
  @MaxLength(9000) // up to 30 links * ~300 chars each
  msdsFileList?: string;
}
