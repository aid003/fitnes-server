import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { PasswordService } from '../common/security/password.service';
import { setAuthenticatedSession } from '../common/auth/session-auth.util';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly passwordService: PasswordService,
  ) {}

  async register(dto: RegisterDto, request: Request) {
    const existingUser = await this.usersService.findByEmail(dto.email);

    if (existingUser) {
      throw new ConflictException('User already exists');
    }

    const passwordHash = await this.passwordService.hash(dto.password);
    const user = await this.usersService.createUser({
      name: dto.name.trim(),
      email: dto.email,
      passwordHash,
    });

    await setAuthenticatedSession(request, {
      id: user.id,
      role: user.role,
    });

    return user;
  }

  async login(dto: LoginDto, request: Request) {
    const user = await this.usersService.findByEmail(dto.email);

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.isActive) {
      throw new ForbiddenException('User is deactivated');
    }

    const isPasswordValid = await this.passwordService.compare(
      dto.password,
      user.passwordHash,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    await setAuthenticatedSession(request, {
      id: user.id,
      role: user.role,
    });

    return this.usersService.getPublicById(user.id);
  }

  async logout(request: Request): Promise<{ success: true }> {
    return new Promise((resolve, reject) => {
      request.session.destroy((error) => {
        if (error) {
          reject(
            error instanceof Error
              ? error
              : new Error('Failed to destroy session'),
          );
          return;
        }

        resolve({ success: true });
      });
    });
  }

  getMe(userId: string) {
    return this.usersService.getMe(userId);
  }
}
