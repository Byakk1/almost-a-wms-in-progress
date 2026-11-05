import { Module } from '@nestjs/common';
import { TaxRatesController } from './tax-rates.controller';
import { TaxRatesService } from './tax-rates.service';

// PrismaService (global PrismaModule) and OperationLogService (global @Global()
// CommonModule) inject without explicit imports — same as RateCardsModule.
//
// TaxRatesService is exported so BillsService can resolve the rate for a shipped
// order's destination instead of reading the table itself.
@Module({
  controllers: [TaxRatesController],
  providers: [TaxRatesService],
  exports: [TaxRatesService],
})
export class TaxRatesModule {}
