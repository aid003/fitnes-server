import {
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { UsersService } from '../../users/users.service';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  let usersService: { getAuthState: jest.Mock };

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    };

    usersService = {
      getAuthState: jest.fn(),
    };

    guard = new RolesGuard(
      reflector as unknown as Reflector,
      usersService as unknown as UsersService,
    );
  });

  it('allows access when there are no role requirements', async () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    await expect(guard.canActivate(createContext())).resolves.toBe(true);
    expect(usersService.getAuthState).not.toHaveBeenCalled();
  });

  it('refreshes stale role from database and allows admin access', async () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    const context = createContext({
      session: {
        auth: {
          userId: 'user-1',
          role: UserRole.USER,
        },
      },
    });

    usersService.getAuthState.mockResolvedValue({
      id: 'user-1',
      role: UserRole.ADMIN,
      isActive: true,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(context.switchToHttp().getRequest().session.auth.role).toBe(
      UserRole.ADMIN,
    );
  });

  it('rejects missing session', async () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);

    await expect(
      guard.canActivate(createContext({ session: undefined })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when database role still lacks permission', async () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.ADMIN]);
    usersService.getAuthState.mockResolvedValue({
      id: 'user-1',
      role: UserRole.USER,
      isActive: true,
    });

    await expect(guard.canActivate(createContext())).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

function createContext(overrides?: {
  session?: {
    auth?: {
      userId: string;
      role: UserRole;
    };
  } | undefined;
}) {
  const request = {
    session:
      overrides && 'session' in overrides
        ? overrides.session
          ? {
              save: (callback: (error?: Error) => void) => callback(),
              ...overrides.session,
            }
          : undefined
        : {
            auth: {
              userId: 'user-1',
              role: UserRole.USER,
            },
            save: (callback: (error?: Error) => void) => callback(),
          },
  };

  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as never;
}
