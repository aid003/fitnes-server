import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpdatePassBadgeDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  style?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
