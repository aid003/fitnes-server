import { BillingType, DurationUnit } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class UpdatePassPlanDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  slug?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  price?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  subtitle?: string;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  durationValue?: number | null;

  @IsOptional()
  @IsEnum(DurationUnit)
  durationUnit?: DurationUnit | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  visitCount?: number | null;

  @IsOptional()
  @IsEnum(BillingType)
  billingType?: BillingType | null;

  @IsOptional()
  @IsString()
  highlightStyle?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
