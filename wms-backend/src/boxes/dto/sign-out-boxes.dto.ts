import { ArrayMinSize, IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/**
 * Sign out a batch of measured boxes onto one carrier waybill. Applied in a single
 * transaction: if any box is missing or not in MEASURED, the whole batch is rejected
 * rather than leaving half a shipment signed out.
 */
export class SignOutBoxesDto {
  @IsArray()
  @ArrayMinSize(1, { message: '至少需要 1 个箱号（boxNos）' })
  @IsString({ each: true })
  boxNos!: string[];

  @IsString()
  @IsNotEmpty({ message: '物流单号不能为空（trackingNo）' })
  trackingNo!: string;

  @IsOptional()
  @IsString()
  courier?: string;
}
