import { Module } from '@nestjs/common';
import { TransitOrdersController } from './transit-orders.controller';
import { TransitOrdersService } from './transit-orders.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [TransitOrdersController],
  providers: [TransitOrdersService],
})
export class TransitOrdersModule {}
