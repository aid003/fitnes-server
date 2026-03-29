import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateTrainerDto {
  @IsString()
  name!: string;

  @IsString()
  slug!: string;

  @IsString()
  role!: string;

  @IsOptional()
  @IsString()
  shortBio?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
