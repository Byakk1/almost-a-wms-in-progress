import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CommonModule } from './common/common.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { CustomersModule } from './customers/customers.module';
import { ProductsModule } from './products/products.module';
import { InventoryModule } from './inventory/inventory.module';
import { LocationsModule } from './locations/locations.module';
import { ReceivingOrdersModule } from './receiving-orders/receiving-orders.module';
import { PutawayTasksModule } from './putaway-tasks/putaway-tasks.module';
import { PutawayRulesModule } from './putaway-rules/putaway-rules.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { OutboundOrdersModule } from './outbound-orders/outbound-orders.module';
import { WavesModule } from './waves/waves.module';
import { WarehousesModule } from './warehouses/warehouses.module';
import { FeeModule } from './fee/fee.module';
import { BillsModule } from './bills/bills.module';
import { TransitOrdersModule } from './transit-orders/transit-orders.module';
import { BoxesModule } from './boxes/boxes.module';
import { RateCardsModule } from './rate-cards/rate-cards.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([
      {
        ttl: 60_000,
        limit: 100,
      },
    ]),
    CommonModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'wms-dev-secret',
    }),
    PrismaModule,
    AuthModule,
    CustomersModule,
    ProductsModule,
    InventoryModule,
    LocationsModule,
    ReceivingOrdersModule,
    PutawayTasksModule,
    PutawayRulesModule,
    DashboardModule,
    OutboundOrdersModule,
    WavesModule,
    WarehousesModule,
    FeeModule,
    BillsModule,
    TransitOrdersModule,
    BoxesModule,
    RateCardsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}