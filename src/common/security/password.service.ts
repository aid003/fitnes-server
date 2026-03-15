import { Injectable } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';

@Injectable()
export class PasswordService {
  private static readonly SALT_ROUNDS = 12;

  hash(password: string): Promise<string> {
    return hash(password, PasswordService.SALT_ROUNDS);
  }

  compare(password: string, passwordHash: string): Promise<boolean> {
    return compare(password, passwordHash);
  }
}
