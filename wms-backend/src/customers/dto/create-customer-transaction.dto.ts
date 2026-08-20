import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Body for POST /customer-transactions.
 *
 * `amount` is the SIGNED delta applied to Customer.balance — a deduction is a
 * negative amount. `type` classifies the movement for reporting; it does not by
 * itself decide the direction, so a mis-typed sign cannot silently invert a
 * top-up into a charge.
 *
 * Deliberately no credit-limit check here: `creditLimit` / `settlementType` govern
 * whether a customer may place orders, not whether finance may record a movement
 * that already happened. Enforcing it at this point would block legitimate
 * corrections to an over-limit account.
 */
export class CreateCustomerTransactionDto {
  @IsString()
  @IsNotEmpty({ message: '客户 ID 不能为空' })
  customerId!: string;

  @IsIn(['topup', 'deduction', 'adjustment'], {
    message: 'type 必须是 topup / deduction / adjustment 之一',
  })
  type!: 'topup' | 'deduction' | 'adjustment';

  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false }, { message: '金额必须是有效数字' })
  amount!: number;

  @IsOptional()
  @IsString()
  description?: string;
}
