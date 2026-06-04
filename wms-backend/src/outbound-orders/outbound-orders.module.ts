import { Module } from '@nestjs/common';
import { OutboundOrdersController } from './outbound-orders.controller';
import { OutboundOrdersService } from './outbound-orders.service';

@Module({
  controllers: [OutboundOrdersController],
  providers: [OutboundOrdersService]
})
export class OutboundOrdersModule {}
