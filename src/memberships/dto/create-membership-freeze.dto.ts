import { IsInt, IsOptional, Min } from 'class-validator';

export class CreateMembershipFreezeDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  days?: number;
}
