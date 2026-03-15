import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { PasswordService } from '../common/security/password.service';
import { setAuthenticatedSession } from '../common/auth/session-auth.util';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UsersService } from '../users/users.service';
import { RequestPasswordRecoveryDto } from './dto/request-password-recovery.dto';
import { ResetPasswordRecoveryDto } from './dto/reset-password-recovery.dto';
import { VerifyPasswordRecoveryDto } from './dto/verify-password-recovery.dto';

const RECOVERY_CHALLENGE_TTL_MS = 15 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly passwordService: PasswordService,
    private readonly prisma: PrismaService,
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

  async requestPasswordRecovery(
    dto: RequestPasswordRecoveryDto,
  ): Promise<{ success: true }> {
    const user = await this.usersService.findByEmail(dto.email);

    if (!user) {
      return { success: true };
    }

    const expiresAt = new Date(Date.now() + RECOVERY_CHALLENGE_TTL_MS);
    const codeHash = await this.passwordService.hash(randomUUID());

    await this.prisma.emailLoginChallenge.deleteMany({
      where: {
        email: dto.email,
      },
    });

    await this.prisma.emailLoginChallenge.create({
      data: {
        email: dto.email,
        codeHash,
        expiresAt,
        userId: user.id,
      },
    });

    return { success: true };
  }

  async verifyPasswordRecovery(
    dto: VerifyPasswordRecoveryDto,
  ): Promise<{ success: true }> {
    const code = dto.code.trim();

    if (!code) {
      throw new BadRequestException('Recovery code is required');
    }

    const challenge = await this.prisma.emailLoginChallenge.findFirst({
      where: {
        email: dto.email,
        expiresAt: {
          gt: new Date(),
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!challenge) {
      return { success: true };
    }

    if (!challenge.consumedAt) {
      await this.prisma.emailLoginChallenge.update({
        where: { id: challenge.id },
        data: {
          consumedAt: new Date(),
        },
      });
    }

    return { success: true };
  }

  async resetPasswordRecovery(
    dto: ResetPasswordRecoveryDto,
  ): Promise<{ success: true }> {
    const code = dto.code.trim();

    if (!code) {
      throw new BadRequestException('Recovery code is required');
    }

    const user = await this.usersService.findByEmail(dto.email);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const challenge = await this.prisma.emailLoginChallenge.findFirst({
      where: {
        email: dto.email,
        userId: user.id,
        expiresAt: {
          gt: new Date(),
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!challenge || !challenge.consumedAt) {
      throw new BadRequestException('Recovery code is not verified');
    }

    const passwordHash = await this.passwordService.hash(dto.password);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
        },
      }),
      this.prisma.emailLoginChallenge.deleteMany({
        where: {
          email: dto.email,
        },
      }),
    ]);

    return { success: true };
  }
}
