import { IsBoolean, IsInt, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export class CreateScheduleSlotDto {
  @IsString()
  @MaxLength(120)
  title!: string;

  @IsString()
  @Matches(TIME_PATTERN, {
    message: 'startTime must match HH:mm',
  })
  startTime!: string;

  @IsString()
  @Matches(TIME_PATTERN, {
    message: 'endTime must match HH:mm',
  })
  endTime!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  ageBadge?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  secondaryBadge?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
