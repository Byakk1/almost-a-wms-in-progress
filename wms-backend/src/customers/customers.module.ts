import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomerTransactionsController } from './customer-transactions.controller';
import { CustomersService } from './customers.service';

@Module({
  controllers: [CustomersController, CustomerTransactionsController],
  providers: [CustomersService]
})
export class CustomersModule {}
