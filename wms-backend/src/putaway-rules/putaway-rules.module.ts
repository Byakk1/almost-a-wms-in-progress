import { Module } from '@nestjs/common';
import { PutawayRulesController } from './putaway-rules.controller';
import { PutawayRulesService } from './putaway-rules.service';

@Module({
  controllers: [PutawayRulesController],
  providers: [PutawayRulesService],
  exports: [PutawayRulesService],
})
export class PutawayRulesModule {}
