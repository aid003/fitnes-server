import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { EmailChallengePurpose } from '@prisma/client';
import type { Request, Response } from 'express';
import { randomInt } from 'node:crypto';
import { PasswordService } from '../common/security/password.service';
import { setAuthenticatedSession } from '../common/auth/session-auth.util';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UsersService } from '../users/users.service';
import { RequestPasswordRecoveryDto } from './dto/request-password-recovery.dto';
import { ResendRegisterCodeDto } from './dto/resend-register-code.dto';
import { ResetPasswordRecoveryDto } from './dto/reset-password-recovery.dto';
import { RememberSessionService } from './session/remember-session.service';
import { SessionService } from './session/session.service';
import { VerifyRegisterDto } from './dto/verify-register.dto';
import { VerifyPasswordRecoveryDto } from './dto/verify-password-recovery.dto';

const CODE_LENGTH = 6;
const RECOVERY_CHALLENGE_TTL_MS = 15 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly passwordService: PasswordService,
    private readonly prisma: PrismaService,
    private readonly mailService: MailService,
    private readonly rememberSessionService: RememberSessionService,
    private readonly sessionService: SessionService,
  ) {}

  async register(dto: RegisterDto): Promise<{ success: true }> {
    const existingUser = await this.usersService.findByEmail(dto.email);

    if (existingUser?.isActive) {
      throw new ConflictException('Пользователь с такой почтой уже существует');
    }

    if (existingUser) {
      const existingChallenge = await this.prisma.emailLoginChallenge.findUnique({
        where: {
          email_purpose: {
            email: dto.email,
            purpose: EmailChallengePurpose.REGISTER,
          },
        },
      });

      this.assertCooldown(existingChallenge?.lastSentAt);
    }

    const passwordHash = await this.passwordService.hash(dto.password);
    const name = dto.name.trim();
    const user = existingUser
      ? await this.prisma.user.update({
          where: { id: existingUser.id },
          data: {
            name,
            passwordHash,
            isActive: false,
          },
          select: {
            id: true,
            email: true,
            name: true,
          },
        })
      : await this.prisma.user.create({
          data: {
            name,
            email: dto.email,
            passwordHash,
            isActive: false,
          },
          select: {
            id: true,
            email: true,
            name: true,
          },
        });

    await this.issueChallenge({
      email: user.email,
      userId: user.id,
      purpose: EmailChallengePurpose.REGISTER,
      recipientName: user.name,
      skipCooldownCheck: true,
    });

    return { success: true };
  }

  async verifyRegister(
    dto: VerifyRegisterDto,
    request: Request,
    response: Response,
  ) {
    const user = await this.usersService.findByEmail(dto.email);

    if (!user) {
      throw new NotFoundException('Заявка на регистрацию не найдена');
    }

    if (user.isActive) {
      throw new BadRequestException('Почта уже подтверждена');
    }

    await this.assertValidChallenge({
      email: dto.email,
      purpose: EmailChallengePurpose.REGISTER,
      code: dto.code,
    });

    const updatedUser = await this.prisma.$transaction(async (tx) => {
      await tx.emailLoginChallenge.delete({
        where: {
          email_purpose: {
            email: dto.email,
            purpose: EmailChallengePurpose.REGISTER,
          },
        },
      });

      return tx.user.update({
        where: { id: user.id },
        data: {
          isActive: true,
        },
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          role: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    });

    await setAuthenticatedSession(request, {
      id: updatedUser.id,
      role: updatedUser.role,
    });
    await this.rememberSessionService.issue(updatedUser.id, response);

    return updatedUser;
  }

  async resendRegisterCode(
    dto: ResendRegisterCodeDto,
  ): Promise<{ success: true }> {
    const user = await this.usersService.findByEmail(dto.email);

    if (!user) {
      throw new NotFoundException('Заявка на регистрацию не найдена');
    }

    if (user.isActive) {
      throw new BadRequestException('Почта уже подтверждена');
    }

    await this.issueChallenge({
      email: user.email,
      userId: user.id,
      purpose: EmailChallengePurpose.REGISTER,
      recipientName: user.name,
    });

    return { success: true };
  }

  async login(dto: LoginDto, request: Request, response: Response) {
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
    await this.rememberSessionService.issue(user.id, response);

    return this.usersService.getPublicById(user.id);
  }

  async logout(request: Request): Promise<{ success: true }> {
    await this.rememberSessionService.revokeByToken(
      this.getRememberTokenFromRequest(request),
    );

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

  async getMeFromSession(request: Request) {
    const userId = request.session?.auth?.userId;

    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }

    return this.usersService.getMe(userId);
  }

  async refreshSession(request: Request, response: Response) {
    const rawToken = this.getRememberTokenFromRequest(request);

    if (!rawToken) {
      throw new UnauthorizedException('Authentication required');
    }

    const rememberedSession = await this.rememberSessionService.rotate(
      rawToken,
      response,
    );

    if (!rememberedSession) {
      this.clearAuthCookies(response);
      throw new UnauthorizedException('Authentication required');
    }

    const user = await this.usersService.getAuthState(rememberedSession.userId);

    if (!user.isActive) {
      await this.rememberSessionService.revokeAllForUser(user.id);
      this.clearAuthCookies(response);
      throw new UnauthorizedException('Authentication required');
    }

    await setAuthenticatedSession(request, {
      id: user.id,
      role: user.role,
    });

    return this.usersService.getMe(user.id);
  }

  clearAuthCookies(response: Response): void {
    this.sessionService.clearSessionCookie(response);
    this.sessionService.clearRememberCookie(response);
  }

  getMe(userId: string) {
    return this.usersService.getMe(userId);
  }

  async requestPasswordRecovery(
    dto: RequestPasswordRecoveryDto,
  ): Promise<{ success: true }> {
    const user = await this.usersService.findByEmail(dto.email);

    if (!user || !user.isActive) {
      return { success: true };
    }

    await this.issueChallenge({
      email: dto.email,
      userId: user.id,
      purpose: EmailChallengePurpose.PASSWORD_RECOVERY,
      recipientName: user.name,
    });

    return { success: true };
  }

  async resendPasswordRecovery(
    dto: RequestPasswordRecoveryDto,
  ): Promise<{ success: true }> {
    return this.requestPasswordRecovery(dto);
  }

  async verifyPasswordRecovery(
    dto: VerifyPasswordRecoveryDto,
  ): Promise<{ success: true }> {
    await this.assertValidChallenge({
      email: dto.email,
      purpose: EmailChallengePurpose.PASSWORD_RECOVERY,
      code: dto.code,
    });

    await this.prisma.emailLoginChallenge.update({
      where: {
        email_purpose: {
          email: dto.email,
          purpose: EmailChallengePurpose.PASSWORD_RECOVERY,
        },
      },
      data: {
        consumedAt: new Date(),
      },
    });

    return { success: true };
  }

  async resetPasswordRecovery(
    dto: ResetPasswordRecoveryDto,
  ): Promise<{ success: true }> {
    const code = dto.code.trim();

    if (!code) {
      throw new BadRequestException('Код восстановления обязателен');
    }

    const user = await this.usersService.findByEmail(dto.email);

    if (!user) {
      throw new NotFoundException('Пользователь не найден');
    }

    const challenge = await this.prisma.emailLoginChallenge.findUnique({
      where: {
        email_purpose: {
          email: dto.email,
          purpose: EmailChallengePurpose.PASSWORD_RECOVERY,
        },
      },
    });

    if (!challenge) {
      throw new BadRequestException('Код не найден. Запросите новый код');
    }

    if (challenge.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException(
        'Срок действия кода истек. Запросите новый код',
      );
    }

    if (!challenge.consumedAt) {
      throw new BadRequestException('Сначала подтвердите код из письма');
    }

    const isCodeValid = await this.passwordService.compare(code, challenge.codeHash);

    if (!isCodeValid) {
      await this.prisma.emailLoginChallenge.update({
        where: {
          email_purpose: {
            email: dto.email,
            purpose: EmailChallengePurpose.PASSWORD_RECOVERY,
          },
        },
        data: {
          attempts: {
            increment: 1,
          },
        },
      });

      throw new BadRequestException('Неверный код');
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
          purpose: EmailChallengePurpose.PASSWORD_RECOVERY,
        },
      }),
    ]);
    await this.rememberSessionService.revokeAllForUser(user.id);

    return { success: true };
  }

  private async issueChallenge(input: {
    email: string;
    userId: string;
    purpose: EmailChallengePurpose;
    recipientName?: string;
    skipCooldownCheck?: boolean;
  }) {
    const existingChallenge = await this.prisma.emailLoginChallenge.findUnique({
      where: {
        email_purpose: {
          email: input.email,
          purpose: input.purpose,
        },
      },
    });

    if (!input.skipCooldownCheck) {
      this.assertCooldown(existingChallenge?.lastSentAt);
    }

    const code = generateNumericCode();
    const codeHash = await this.passwordService.hash(code);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + RECOVERY_CHALLENGE_TTL_MS);

    await this.prisma.emailLoginChallenge.upsert({
      where: {
        email_purpose: {
          email: input.email,
          purpose: input.purpose,
        },
      },
      create: {
        email: input.email,
        purpose: input.purpose,
        userId: input.userId,
        codeHash,
        expiresAt,
        lastSentAt: now,
        attempts: 0,
      },
      update: {
        userId: input.userId,
        codeHash,
        expiresAt,
        consumedAt: null,
        lastSentAt: now,
        attempts: 0,
      },
    });

    if (input.purpose === EmailChallengePurpose.REGISTER) {
      await this.mailService.sendRegistrationCode({
        to: input.email,
        recipientName: input.recipientName,
        code,
        expiresAt,
      });
      return;
    }

    await this.mailService.sendPasswordRecoveryCode({
      to: input.email,
      recipientName: input.recipientName,
      code,
      expiresAt,
    });
  }

  private async assertValidChallenge(input: {
    email: string;
    purpose: EmailChallengePurpose;
    code: string;
  }) {
    const challenge = await this.prisma.emailLoginChallenge.findUnique({
      where: {
        email_purpose: {
          email: input.email,
          purpose: input.purpose,
        },
      },
    });

    if (!challenge) {
      throw new BadRequestException('Код не найден. Запросите новый код');
    }

    if (challenge.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException(
        'Срок действия кода истек. Запросите новый код',
      );
    }

    if (challenge.consumedAt) {
      throw new BadRequestException('Код уже был использован');
    }

    const isCodeValid = await this.passwordService.compare(
      input.code.trim(),
      challenge.codeHash,
    );

    if (!isCodeValid) {
      await this.prisma.emailLoginChallenge.update({
        where: {
          email_purpose: {
            email: input.email,
            purpose: input.purpose,
          },
        },
        data: {
          attempts: {
            increment: 1,
          },
        },
      });

      throw new BadRequestException('Неверный код');
    }

    return challenge;
  }

  private assertCooldown(lastSentAt?: Date) {
    if (!lastSentAt) {
      return;
    }

    const availableAt = lastSentAt.getTime() + RESEND_COOLDOWN_MS;

    if (availableAt > Date.now()) {
      throw new BadRequestException(
        'Повторная отправка будет доступна через 60 секунд',
      );
    }
  }

  private getRememberTokenFromRequest(request: Request): string | undefined {
    const cookieHeader = request.headers.cookie;

    if (!cookieHeader) {
      return undefined;
    }

    const rememberCookieName = this.sessionService.getRememberCookieName();

    for (const chunk of cookieHeader.split(';')) {
      const trimmedChunk = chunk.trim();
      const [name, ...rest] = trimmedChunk.split('=');

      if (name === rememberCookieName) {
        return decodeURIComponent(rest.join('='));
      }
    }

    return undefined;
  }
}

function generateNumericCode() {
  const min = 10 ** (CODE_LENGTH - 1);
  const max = 10 ** CODE_LENGTH;

  return String(randomInt(min, max));
}
