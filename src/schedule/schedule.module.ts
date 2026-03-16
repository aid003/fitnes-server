import { Module } from '@nestjs/common';
import { ScheduleAdminController } from './schedule-admin.controller';
import { ScheduleController } from './schedule.controller';
import { ScheduleService } from './schedule.service';

@Module({
  controllers: [ScheduleController, ScheduleAdminController],
  providers: [ScheduleService],
})
export class ScheduleModule {}
