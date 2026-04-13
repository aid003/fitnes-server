import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { EmailChallengePurpose, UserRole } from '@prisma/client';
import type { Request, Response } from 'express';
import { RememberSessionService } from './session/remember-session.service';
import { SessionService } from './session/session.service';
import { PasswordService } from '../common/security/password.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import type { PublicUser } from '../users/users.service';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let authService: AuthService;
  let usersService: {
    findByEmail: jest.Mock;
    createUser: jest.Mock;
    getPublicById: jest.Mock;
    getAuthState: jest.Mock;
    getMe: jest.Mock;
  };
  let passwordService: {
    hash: jest.Mock;
    compare: jest.Mock;
  };
  let prismaService: {
    emailLoginChallenge: {
      delete: jest.Mock;
      deleteMany: jest.Mock;
      findUnique: jest.Mock;
      upsert: jest.Mock;
      update: jest.Mock;
    };
    user: {
      create: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let mailService: {
    sendRegistrationCode: jest.Mock;
    sendPasswordRecoveryCode: jest.Mock;
  };
  let rememberSessionService: {
    issue: jest.Mock;
    rotate: jest.Mock;
    revokeByToken: jest.Mock;
    revokeAllForUser: jest.Mock;
  };
  let sessionService: {
    clearSessionCookie: jest.Mock;
    clearRememberCookie: jest.Mock;
    getRememberCookieName: jest.Mock;
  };

  beforeEach(() => {
    usersService = {
      findByEmail: jest.fn(),
      createUser: jest.fn(),
      getPublicById: jest.fn(),
      getAuthState: jest.fn(),
      getMe: jest.fn(),
    };

    passwordService = {
      hash: jest.fn(),
      compare: jest.fn(),
    };

    prismaService = {
      emailLoginChallenge: {
        delete: jest.fn(),
        deleteMany: jest.fn(),
        findUnique: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
      },
      user: {
        create: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest
        .fn()
        .mockImplementation(async (input) =>
          typeof input === 'function'
            ? input({
                emailLoginChallenge: prismaService.emailLoginChallenge,
                user: prismaService.user,
              })
            : Promise.all(input),
        ),
    };

    mailService = {
      sendRegistrationCode: jest.fn(),
      sendPasswordRecoveryCode: jest.fn(),
    };

    rememberSessionService = {
      issue: jest.fn(),
      rotate: jest.fn(),
      revokeByToken: jest.fn(),
      revokeAllForUser: jest.fn(),
    };

    sessionService = {
      clearSessionCookie: jest.fn(),
      clearRememberCookie: jest.fn(),
      getRememberCookieName: jest.fn().mockReturnValue('remember_sid'),
    };

    authService = new AuthService(
      usersService as unknown as UsersService,
      passwordService as unknown as PasswordService,
      prismaService as unknown as PrismaService,
      mailService as unknown as MailService,
      rememberSessionService as unknown as RememberSessionService,
      sessionService as unknown as SessionService,
    );
  });

  it('creates an inactive user and sends a registration code', async () => {
    usersService.findByEmail.mockResolvedValue(null);
    passwordService.hash.mockResolvedValue('hashed-password');
    prismaService.emailLoginChallenge.findUnique.mockResolvedValue(null);
    prismaService.user.create.mockResolvedValue({
      id: 'user-1',
      email: 'test@example.com',
      name: 'Test User',
    });

    const result = await authService.register(
      {
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      },
    );

    expect(passwordService.hash.mock.calls[0]).toEqual(['password123']);
    expect(prismaService.user.create).toHaveBeenCalledWith({
      data: {
        name: 'Test User',
        email: 'test@example.com',
        passwordHash: 'hashed-password',
        isActive: false,
      },
      select: {
        id: true,
        email: true,
        name: true,
      },
    });
    expect(prismaService.emailLoginChallenge.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          purpose: EmailChallengePurpose.REGISTER,
        }),
      }),
    );
    expect(mailService.sendRegistrationCode).toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  it('rejects login for inactive users', async () => {
    const request = createRequest();
    const response = createResponse();

    usersService.findByEmail.mockResolvedValue(
      createStoredUser({ isActive: false }),
    );

    await expect(
      authService.login(
        {
          email: 'test@example.com',
          password: 'password123',
        },
        request,
        response,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects login when password is invalid', async () => {
    const request = createRequest();
    const response = createResponse();

    usersService.findByEmail.mockResolvedValue(createStoredUser());
    passwordService.compare.mockResolvedValue(false);

    await expect(
      authService.login(
        {
          email: 'test@example.com',
          password: 'password123',
        },
        request,
        response,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects duplicate registration', async () => {
    usersService.findByEmail.mockResolvedValue(createStoredUser());

    await expect(
      authService.register({
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('verifies register code, activates user and creates session', async () => {
    const request = createRequest();
    const response = createResponse();

    usersService.findByEmail.mockResolvedValue(createStoredUser({ isActive: false }));
    prismaService.emailLoginChallenge.findUnique.mockResolvedValue({
      email: 'test@example.com',
      purpose: EmailChallengePurpose.REGISTER,
      codeHash: 'stored-code-hash',
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    });
    passwordService.compare.mockResolvedValue(true);
    prismaService.user.update.mockResolvedValue(createPublicUser());

    const result = await authService.verifyRegister(
      {
        email: 'test@example.com',
        code: '123456',
      },
      request,
      response,
    );

    expect(prismaService.emailLoginChallenge.delete).toHaveBeenCalledWith({
      where: {
        email_purpose: {
          email: 'test@example.com',
          purpose: EmailChallengePurpose.REGISTER,
        },
      },
    });
    expect(request.session.auth).toEqual({
      userId: 'user-1',
      role: UserRole.USER,
    });
    expect(rememberSessionService.issue).toHaveBeenCalledWith('user-1', response);
    expect(result.email).toBe('test@example.com');
  });

  it('creates remember cookie on login', async () => {
    const request = createRequest();
    const response = createResponse();

    usersService.findByEmail.mockResolvedValue(createStoredUser());
    usersService.getPublicById.mockResolvedValue(createPublicUser());
    passwordService.compare.mockResolvedValue(true);

    const result = await authService.login(
      {
        email: 'test@example.com',
        password: 'password123',
      },
      request,
      response,
    );

    expect(rememberSessionService.issue).toHaveBeenCalledWith('user-1', response);
    expect(result).toMatchObject({
      id: 'user-1',
      email: 'test@example.com',
    });
  });

  it('restores session from remember token', async () => {
    const request = createRequest('remember_sid=remember-token');
    const response = createResponse();

    rememberSessionService.rotate.mockResolvedValue({
      id: 'remember-1',
      userId: 'user-1',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
    });
    usersService.getAuthState = jest.fn().mockResolvedValue({
      id: 'user-1',
      role: UserRole.USER,
      isActive: true,
    });
    usersService.getMe.mockResolvedValue(createPublicUser());

    const result = await authService.refreshSession(request, response);

    expect(rememberSessionService.rotate).toHaveBeenCalledWith(
      'remember-token',
      response,
    );
    expect(request.session.auth).toEqual({
      userId: 'user-1',
      role: UserRole.USER,
    });
    expect(result).toMatchObject({
      id: 'user-1',
      email: 'test@example.com',
    });
  });

  it('creates a recovery challenge for an existing user', async () => {
    usersService.findByEmail.mockResolvedValue(createStoredUser());
    passwordService.hash.mockResolvedValue('challenge-hash');
    prismaService.emailLoginChallenge.findUnique.mockResolvedValue(null);

    const result = await authService.requestPasswordRecovery({
      email: 'test@example.com',
    });

    expect(prismaService.emailLoginChallenge.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          purpose: EmailChallengePurpose.PASSWORD_RECOVERY,
        }),
      }),
    );
    expect(mailService.sendPasswordRecoveryCode).toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  it('verifies recovery code only when it matches stored hash', async () => {
    prismaService.emailLoginChallenge.findUnique.mockResolvedValue({
      email: 'test@example.com',
      purpose: EmailChallengePurpose.PASSWORD_RECOVERY,
      codeHash: 'stored-code-hash',
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    });
    passwordService.compare.mockResolvedValue(true);

    const result = await authService.verifyPasswordRecovery({
      email: 'test@example.com',
      code: '123456',
    });

    expect(prismaService.emailLoginChallenge.update).toHaveBeenCalledWith({
      where: {
        email_purpose: {
          email: 'test@example.com',
          purpose: EmailChallengePurpose.PASSWORD_RECOVERY,
        },
      },
      data: {
        consumedAt: expect.any(Date),
      },
    });
    expect(result).toEqual({ success: true });
  });

  it('rejects reset when recovery code was not verified', async () => {
    usersService.findByEmail.mockResolvedValue(createStoredUser());
    prismaService.emailLoginChallenge.findUnique.mockResolvedValue({
      email: 'test@example.com',
      purpose: EmailChallengePurpose.PASSWORD_RECOVERY,
      codeHash: 'stored-code-hash',
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    });

    await expect(
      authService.resetPasswordRecovery({
        email: 'test@example.com',
        code: '123456',
        password: 'password123',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('updates password and removes challenges after verified recovery', async () => {
    usersService.findByEmail.mockResolvedValue(createStoredUser());
    prismaService.emailLoginChallenge.findUnique.mockResolvedValue({
      email: 'test@example.com',
      purpose: EmailChallengePurpose.PASSWORD_RECOVERY,
      codeHash: 'stored-code-hash',
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: new Date(),
      userId: 'user-1',
    });
    passwordService.compare.mockResolvedValue(true);
    passwordService.hash.mockResolvedValue('hashed-password');
    prismaService.user.update.mockResolvedValue(undefined);
    prismaService.emailLoginChallenge.deleteMany.mockResolvedValue(undefined);

    const result = await authService.resetPasswordRecovery({
      email: 'test@example.com',
      code: '654321',
      password: 'password123',
    });

    expect(prismaService.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { passwordHash: 'hashed-password' },
    });
    expect(rememberSessionService.revokeAllForUser).toHaveBeenCalledWith('user-1');
    expect(result).toEqual({ success: true });
  });

  it('returns not found on reset for a missing user', async () => {
    usersService.findByEmail.mockResolvedValue(null);

    await expect(
      authService.resetPasswordRecovery({
        email: 'missing@example.com',
        code: '123456',
        password: 'password123',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('blocks resend when cooldown is active', async () => {
    usersService.findByEmail.mockResolvedValue(createStoredUser({ isActive: false }));
    prismaService.emailLoginChallenge.findUnique.mockResolvedValue({
      email: 'test@example.com',
      purpose: EmailChallengePurpose.REGISTER,
      codeHash: 'stored-code-hash',
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      lastSentAt: new Date(),
    });

    await expect(
      authService.resendRegisterCode({
        email: 'test@example.com',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

function createRequest(cookieHeader?: string): Request {
  return {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
    session: {
      save: (callback: (error?: Error) => void) => callback(),
      destroy: (callback: (error?: Error) => void) => callback(),
    },
  } as unknown as Request;
}

function createResponse(): Response {
  return {} as Response;
}

function createPublicUser(): PublicUser {
  return {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    role: UserRole.USER,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createStoredUser(
  overrides?: Partial<ReturnType<typeof createStoredUserBase>>,
) {
  return {
    ...createStoredUserBase(),
    ...overrides,
  };
}

function createStoredUserBase() {
  return {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    passwordHash: 'stored-hash',
    role: UserRole.USER,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
