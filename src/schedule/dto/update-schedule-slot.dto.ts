import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { SCHEDULE_WEEKDAY } from '../schedule.constants';
import type { ScheduleWeekdayValue } from './create-template-slot.dto';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class UpdateScheduleSlotDto {
  @IsOptional()
  @IsEnum(SCHEDULE_WEEKDAY)
  weekday?: ScheduleWeekdayValue;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @Matches(TIME_PATTERN, {
    message: 'startTime must match HH:mm',
  })
  startTime?: string;

  @IsOptional()
  @IsString()
  @Matches(TIME_PATTERN, {
    message: 'endTime must match HH:mm',
  })
  endTime?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  ageBadge?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  secondaryBadge?: string;

  @IsOptional()
  @IsBoolean()
  bookingEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
