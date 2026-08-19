import { IsNumber, IsPositive } from 'class-validator';

/**
 * Box measurement DTO. Dimensions in cm, weight in kg — all `Float` columns.
 *
 * Only the four measured inputs are accepted; `volWeight` and `chargeWeight` are
 * derived server-side (see BoxesService.measure) so the client cannot disagree
 * with the billing figure. `@IsPositive` rejects 0 / negatives / NaN / Infinity.
 */
export class MeasureBoxDto {
  @IsNumber({}, { message: '长度必须为数字（length）' })
  @IsPositive({ message: '长度必须大于 0' })
  length!: number;

  @IsNumber({}, { message: '宽度必须为数字（width）' })
  @IsPositive({ message: '宽度必须大于 0' })
  width!: number;

  @IsNumber({}, { message: '高度必须为数字（height）' })
  @IsPositive({ message: '高度必须大于 0' })
  height!: number;

  @IsNumber({}, { message: '实重必须为数字（actualWeight）' })
  @IsPositive({ message: '实重必须大于 0' })
  actualWeight!: number;
}
