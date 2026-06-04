import { Module } from '@nestjs/common';
import { WavesController } from './waves.controller';
import { WavesService } from './waves.service';

// PrismaService (global PrismaModule) and OperationLogService (global @Global() CommonModule)
// inject without explicit imports — same as OutboundOrdersModule.
@Module({
  controllers: [WavesController],
  providers: [WavesService],
})
export class WavesModule {}
