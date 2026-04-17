import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateSelfDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ValidateIf((object: UpdateSelfDto) => object.newPassword !== undefined)
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  currentPassword?: string;

  @ValidateIf((object: UpdateSelfDto) => object.currentPassword !== undefined)
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword?: string;
}
