import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthenticatedGuard } from '../common/auth/authenticated.guard';
import { ScheduleService } from './schedule.service';

@Controller('schedule')
@UseGuards(AuthenticatedGuard)
export class ScheduleController {
  constructor(private readonly scheduleService: ScheduleService) {}

  @Get('days')
  listDays(@Query('from') from?: string, @Res({ passthrough: true }) response?: Response) {
    response?.setHeader('Cache-Control', 'no-store');
    return this.scheduleService.listDays(from);
  }

  @Get()
  getDay(@Query('date') date?: string, @Res({ passthrough: true }) response?: Response) {
    response?.setHeader('Cache-Control', 'no-store');
    return this.scheduleService.getDaySchedule(date);
  }
}
