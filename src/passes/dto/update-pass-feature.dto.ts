import { PassFeatureIcon } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpdatePassFeatureDto {
  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsEnum(PassFeatureIcon)
  icon?: PassFeatureIcon;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
