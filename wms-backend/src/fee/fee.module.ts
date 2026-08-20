import { Module } from '@nestjs/common';
import { FeeController } from './fee.controller';
import { FeeService } from './fee.service';
import { PrismaModule } from '../prisma/prisma.module';
import { RateCardsModule } from '../rate-cards/rate-cards.module';

@Module({
  imports: [PrismaModule, RateCardsModule],
  controllers: [FeeController],
  providers: [FeeService],
})
export class FeeModule {}
