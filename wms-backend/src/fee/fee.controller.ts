import { Controller, Post, Body } from '@nestjs/common';
import { FeeService } from './fee.service';
// `import type` is required: emitDecoratorMetadata + isolatedModules reject a
// value-imported type in a decorated signature (TS1272).
import type { CalculateFeeBody } from './fee.service';
import { Roles } from '../common/decorators/roles.decorator';
import { ok } from '../common/api-response';

@Controller('fee')
export class FeeController {
  constructor(private readonly feeService: FeeService) {}

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR', 'CUSTOMER_SERVICE', 'FINANCE', 'CUSTOMER')
  @Post('calculate')
  async calculateFee(@Body() body: CalculateFeeBody) {
    const result = await this.feeService.calculateFee(body);
    return ok(result);
  }
}
