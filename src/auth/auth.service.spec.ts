import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import type { Request } from 'express';
import { PasswordService } from '../common/security/password.service';
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

    authService = new AuthService(
      usersService as unknown as UsersService,
      passwordService as unknown as PasswordService,
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
