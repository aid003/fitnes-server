import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { PasswordService } from '../common/security/password.service';
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
    getMe: jest.Mock;
  };
  let passwordService: {
    hash: jest.Mock;
    compare: jest.Mock;
  };
  let prismaService: {
    emailLoginChallenge: {
      create: jest.Mock;
      deleteMany: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    user: {
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(() => {
    usersService = {
      findByEmail: jest.fn(),
      createUser: jest.fn(),
      getPublicById: jest.fn(),
      getMe: jest.fn(),
    };

    passwordService = {
      hash: jest.fn(),
      compare: jest.fn(),
    };

    prismaService = {
      emailLoginChallenge: {
        create: jest.fn(),
        deleteMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      user: {
        update: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation(async (operations) => Promise.all(operations)),
    };

    authService = new AuthService(
      usersService as unknown as UsersService,
      passwordService as unknown as PasswordService,
      prismaService as unknown as PrismaService,
    );
  });

  it('registers a user with hashed password and session', async () => {
    const request = createRequest();

    usersService.findByEmail.mockResolvedValue(null);
    passwordService.hash.mockResolvedValue('hashed-password');
    usersService.createUser.mockResolvedValue(createPublicUser());

    const result = await authService.register(
      {
        name: 'Test User',
        email: 'test@example.com',
        password: 'password123',
      },
      request,
    );

    expect(passwordService.hash.mock.calls[0]).toEqual(['password123']);
    expect(usersService.createUser.mock.calls[0]).toEqual([
      {
        name: 'Test User',
        email: 'test@example.com',
        passwordHash: 'hashed-password',
      },
    ]);
    expect(request.session.auth).toEqual({
      userId: 'user-1',
      role: UserRole.USER,
    });
    expect(result.email).toBe('test@example.com');
  });

  it('rejects login for inactive users', async () => {
    const request = createRequest();

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
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects login when password is invalid', async () => {
    const request = createRequest();

    usersService.findByEmail.mockResolvedValue(createStoredUser());
    passwordService.compare.mockResolvedValue(false);

    await expect(
      authService.login(
        {
          email: 'test@example.com',
          password: 'password123',
        },
        request,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects duplicate registration', async () => {
    const request = createRequest();

    usersService.findByEmail.mockResolvedValue(createStoredUser());

    await expect(
      authService.register(
        {
          name: 'Test User',
          email: 'test@example.com',
          password: 'password123',
        },
        request,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates a recovery challenge for an existing user', async () => {
    usersService.findByEmail.mockResolvedValue(createStoredUser());
    passwordService.hash.mockResolvedValue('challenge-hash');

    const result = await authService.requestPasswordRecovery({
      email: 'test@example.com',
    });

    expect(prismaService.emailLoginChallenge.deleteMany).toHaveBeenCalledWith({
      where: { email: 'test@example.com' },
    });
    expect(prismaService.emailLoginChallenge.create).toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  it('accepts any non-empty recovery code when challenge exists', async () => {
    prismaService.emailLoginChallenge.findFirst.mockResolvedValue({
      id: 'challenge-1',
      consumedAt: null,
    });

    const result = await authService.verifyPasswordRecovery({
      email: 'test@example.com',
      code: '123456',
    });

    expect(prismaService.emailLoginChallenge.update).toHaveBeenCalledWith({
      where: { id: 'challenge-1' },
      data: {
        consumedAt: expect.any(Date),
      },
    });
    expect(result).toEqual({ success: true });
  });

  it('rejects reset when recovery code was not verified', async () => {
    usersService.findByEmail.mockResolvedValue(createStoredUser());
    prismaService.emailLoginChallenge.findFirst.mockResolvedValue({
      id: 'challenge-1',
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
    prismaService.emailLoginChallenge.findFirst.mockResolvedValue({
      id: 'challenge-1',
      consumedAt: new Date(),
      userId: 'user-1',
    });
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
});

function createRequest(): Request {
  return {
    session: {
      save: (callback: (error?: Error) => void) => callback(),
      destroy: (callback: (error?: Error) => void) => callback(),
    },
  } as unknown as Request;
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
