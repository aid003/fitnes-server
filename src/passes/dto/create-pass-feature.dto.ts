import { PassFeatureIcon } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreatePassFeatureDto {
  @IsString()
  label!: string;

  @IsEnum(PassFeatureIcon)
  icon!: PassFeatureIcon;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
