import { Module } from '@nestjs/common';
import { RateCardsController } from './rate-cards.controller';
import { RateCardsService } from './rate-cards.service';

// PrismaService (global PrismaModule) and OperationLogService (global @Global()
// CommonModule) inject without explicit imports — same as BoxesModule.
//
// RateCardsService is exported so FeeService can price against real cards
// instead of its hardcoded rateMatrix.
@Module({
  controllers: [RateCardsController],
  providers: [RateCardsService],
  exports: [RateCardsService],
})
export class RateCardsModule {}
