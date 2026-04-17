import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PasswordService } from '../common/security/password.service';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let usersService: UsersService;
  let prismaService: {
    user: {
      findUnique: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
    };
    rememberSession: {
      updateMany: jest.Mock;
    };
  };
  let passwordService: {
    hash: jest.Mock;
    compare: jest.Mock;
  };

  beforeEach(() => {
    prismaService = {
      user: {
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
      },
      rememberSession: {
        updateMany: jest.fn(),
      },
    };

    passwordService = {
      hash: jest.fn(),
      compare: jest.fn(),
    };

    usersService = new UsersService(
      prismaService as unknown as PrismaService,
      passwordService as unknown as PasswordService,
    );
  });

  it('requires both currentPassword and newPassword when changing password', async () => {
    prismaService.user.findUnique.mockResolvedValue(createStoredUser());

    await expect(
      usersService.updateMe('user-1', {
        currentPassword: 'old-password',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects self password change with invalid current password', async () => {
    prismaService.user.findUnique.mockResolvedValue(createStoredUser());
    passwordService.compare.mockResolvedValue(false);

    await expect(
      usersService.updateMe('user-1', {
        currentPassword: 'wrong-password',
        newPassword: 'new-password-123',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('stores normalized phone on self update', async () => {
    prismaService.user.findUnique.mockResolvedValue(createStoredUser());
    prismaService.user.update.mockResolvedValue({
      ...createStoredUser(),
      phone: '+79991234567',
    });

    const result = await usersService.updateMe('user-1', {
      phone: '  +79991234567  ',
    });

    expect(prismaService.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-1' },
        data: expect.objectContaining({
          phone: '+79991234567',
        }),
      }),
    );
    expect(result.phone).toBe('+79991234567');
  });

  it('updates status for admin management', async () => {
    prismaService.user.findUnique.mockResolvedValue({
      id: 'user-2',
    });
    prismaService.user.update.mockResolvedValue({
      id: 'user-2',
      email: 'admin-managed@example.com',
      name: 'Managed User',
      phone: null,
      role: UserRole.COACH,
      isActive: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await usersService.updateUserStatus('user-2', false);
    const updateCalls = prismaService.user.update.mock.calls as Array<
      [
        {
          where: { id: string };
          data: { isActive: boolean };
          select: unknown;
        },
      ]
    >;

    expect(updateCalls[0][0]).toMatchObject({
      where: { id: 'user-2' },
      data: { isActive: false },
    });
    expect(updateCalls[0][0].select).toBeDefined();
    expect(result.isActive).toBe(false);
  });
});

function createStoredUser() {
  return {
    id: 'user-1',
    email: 'test@example.com',
    name: 'Test User',
    phone: null,
    passwordHash: 'stored-hash',
    role: UserRole.USER,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
