import { Module } from '@nestjs/common';
import { PutawayTasksController } from './putaway-tasks.controller';
import { PutawayTasksService } from './putaway-tasks.service';
import { PutawayRulesModule } from '../putaway-rules/putaway-rules.module';

@Module({
  imports: [PutawayRulesModule],
  controllers: [PutawayTasksController],
  providers: [PutawayTasksService]
})
export class PutawayTasksModule {}
