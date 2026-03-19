import { Transform } from 'class-transformer';
import { IsEmail, IsString, Length } from 'class-validator';

export class VerifyRegisterDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : (value as unknown),
  )
  @IsEmail()
  email!: string;

  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : (value as unknown),
  )
  @IsString()
  @Length(6, 6)
  code!: string;
}
