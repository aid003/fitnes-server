import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

const TARGET_URL_PATTERN = /^(https?:\/\/|\/).+/i;

export class CreateAdDto {
  @IsString()
  title!: string;

  @IsString()
  @Matches(TARGET_URL_PATTERN, {
    message: 'Ссылка должна начинаться с http://, https:// или /',
  })
  targetUrl!: string;

  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;

  @IsInt()
  @Min(1)
  repeatIntervalDays!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
