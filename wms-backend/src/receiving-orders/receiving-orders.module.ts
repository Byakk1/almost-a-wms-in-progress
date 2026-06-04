import { Module } from '@nestjs/common';
import { ReceivingOrdersController } from './receiving-orders.controller';
import { ReceivingOrdersService } from './receiving-orders.service';

@Module({
  controllers: [ReceivingOrdersController],
  providers: [ReceivingOrdersService]
})
export class ReceivingOrdersModule {}
