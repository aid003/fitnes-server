import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthenticatedGuard } from '../common/auth/authenticated.guard';
import { Roles } from '../common/auth/roles.decorator';
import { USER_ROLE } from './schedule.constants';
import { CreateTemplateSlotDto } from './dto/create-template-slot.dto';
import { UpdateScheduleSlotDto } from './dto/update-schedule-slot.dto';
import { ScheduleService } from './schedule.service';

@Controller('admin/schedule')
@UseGuards(AuthenticatedGuard)
@Roles(USER_ROLE.ADMIN)
export class ScheduleAdminController {
  constructor(private readonly scheduleService: ScheduleService) {}

  @Get('workspace')
  getWorkspace(@Query('date') date?: string, @Res({ passthrough: true }) response?: Response) {
    response?.setHeader('Cache-Control', 'no-store');
    return this.scheduleService.getAdminWorkspace(date);
  }

  @Post('template-slots')
  createTemplateSlot(@Body() dto: CreateTemplateSlotDto) {
    return this.scheduleService.createTemplateSlot(dto);
  }

  @Patch('template-slots/:id')
  updateTemplateSlot(
    @Param('id') slotId: string,
    @Body() dto: UpdateScheduleSlotDto,
  ) {
    return this.scheduleService.updateTemplateSlot(slotId, dto);
  }

  @Delete('template-slots/:id')
  deleteTemplateSlot(@Param('id') slotId: string) {
    return this.scheduleService.deleteTemplateSlot(slotId);
  }
}
