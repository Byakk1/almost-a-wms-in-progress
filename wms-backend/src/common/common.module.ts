import { Global, Module } from '@nestjs/common';
import { MockDbService } from './mock-db.service';
import { InventoryTransactionService } from './inventory-transaction.service';
import { OperationLogService } from './operation-log.service';
import { ExceptionCaseService } from './exception-case.service';
import { DictionaryService } from './dictionary.service';
import { AuditController } from './audit.controller';
import { ExceptionCaseController } from './exception-case.controller';
import { DictionaryController } from './dictionary.controller';

@Global()
@Module({
  controllers: [AuditController, ExceptionCaseController, DictionaryController],
  providers: [
    MockDbService,
    InventoryTransactionService,
    OperationLogService,
    ExceptionCaseService,
    DictionaryService,
  ],
  exports: [
    MockDbService,
    InventoryTransactionService,
    OperationLogService,
    ExceptionCaseService,
    DictionaryService,
  ],
})
export class CommonModule {}