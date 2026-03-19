import { Transform } from 'class-transformer';
import { IsEmail } from 'class-validator';

export class ResendRegisterCodeDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : (value as unknown),
  )
  @IsEmail()
  email!: string;
}
