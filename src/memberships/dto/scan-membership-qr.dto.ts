import { IsString } from 'class-validator';

export class ScanMembershipQrDto {
  @IsString()
  content!: string;
}
