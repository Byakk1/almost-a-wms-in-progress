import { Module } from '@nestjs/common';
import { BoxesController } from './boxes.controller';
import { BoxesService } from './boxes.service';

// PrismaService (global PrismaModule) and OperationLogService (global @Global() CommonModule)
// inject without explicit imports — same as WavesModule.
@Module({
  controllers: [BoxesController],
  providers: [BoxesService],
})
export class BoxesModule {}
