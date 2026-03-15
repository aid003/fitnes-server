import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateMembershipRenewalDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
