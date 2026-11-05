import { Module } from '@nestjs/common';
import { SurchargesController } from './surcharges.controller';
import { SurchargesService } from './surcharges.service';

// PrismaService (global PrismaModule) and OperationLogService (global @Global()
// CommonModule) inject without explicit imports — same as TaxRatesModule.
//
// SurchargesService is exported so BillsService can resolve the surcharges that
// apply to a shipped order instead of reading the table itself.
@Module({
  controllers: [SurchargesController],
  providers: [SurchargesService],
  exports: [SurchargesService],
})
export class SurchargesModule {}
