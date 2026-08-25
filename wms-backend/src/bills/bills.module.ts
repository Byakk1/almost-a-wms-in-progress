import { Module } from '@nestjs/common';
import { BillsController } from './bills.controller';
import { BillsService } from './bills.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RateCardsModule } from '../rate-cards/rate-cards.module';

// OperationLogService comes from the global @Global() CommonModule.
@Module({
  imports: [PrismaModule, RateCardsModule],
  controllers: [BillsController],
  providers: [BillsService],
})
export class BillsModule {}
