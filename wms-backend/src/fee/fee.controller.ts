import { Controller, Post, Body } from '@nestjs/common';
import { FeeService } from './fee.service';
import { Roles } from '../common/decorators/roles.decorator';
import { ok } from '../common/api-response';

@Controller('fee')
export class FeeController {
  constructor(private readonly feeService: FeeService) {}

  @Roles('SUPER_ADMIN', 'WAREHOUSE_ADMIN', 'OPERATOR', 'CUSTOMER_SERVICE', 'FINANCE', 'CUSTOMER')
  @Post('calculate')
  async calculateFee(
    @Body()
    body: {
      customerId: string;
      warehouseId: string;
      items: Array<{ productId: string; qty: number }>;
      shippingMode: 'AIR' | 'SEA' | 'EXPRESS';
      destinationCountry?: string;
    },
  ) {
    const result = await this.feeService.calculateFee(body);
    return ok(result);
  }
}
