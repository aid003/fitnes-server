import { IsEnum } from 'class-validator';
import { CreateScheduleSlotDto } from './create-schedule-slot.dto';
import { SCHEDULE_WEEKDAY } from '../schedule.constants';

export type ScheduleWeekdayValue =
  (typeof SCHEDULE_WEEKDAY)[keyof typeof SCHEDULE_WEEKDAY];

export class CreateTemplateSlotDto extends CreateScheduleSlotDto {
  @IsEnum(SCHEDULE_WEEKDAY)
  weekday!: ScheduleWeekdayValue;
}
