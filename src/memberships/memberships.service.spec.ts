import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MembershipsService } from './memberships.service';

describe('MembershipsService', () => {
  let membershipsService: MembershipsService;
  let prismaService: Record<string, any>;

  const membershipRecord = {
    id: 'membership-1',
    title: 'Безлимит - Бассейн + Зал',
    subtitle: 'Действует до 12 мая 2026',
    description: null,
    startsAt: new Date('2026-03-01T00:00:00.000Z'),
    endsAt: new Date('2026-05-12T00:00:00.000Z'),
    status: 'ACTIVE',
    freezeDaysLimit: 30,
    freezeDaysUsed: 0,
    canRenew: true,
    sortOrder: 0,
    createdAt: new Date('2026-03-01T00:00:00.000Z'),
    updatedAt: new Date('2026-03-01T00:00:00.000Z'),
    user: {
      id: 'user-1',
      name: 'User',
      email: 'user@example.com',
    },
    passPlan: {
      id: 'plan-1',
      title: 'Безлимит - Бассейн + Зал',
      subtitle: null,
      description: null,
      features: [
        {
          id: 'feature-1',
          label: 'Безлимитное посещение',
          icon: 'TICKET',
          sortOrder: 0,
        },
      ],
    },
    freezes: [],
    renewalRequests: [],
  };

  beforeEach(() => {
    prismaService = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user-1' }),
      },
      passPlan: {
        findUnique: jest.fn(),
      },
      userMembership: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      userMembershipFreeze: {
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      userMembershipRenewalRequest: {
        create: jest.fn(),
      },
      $transaction: jest.fn(async (operations: Array<Promise<unknown>>) =>
        Promise.all(operations),
      ),
    };

    membershipsService = new MembershipsService(prismaService as PrismaService);
  });

  it('splits active and completed memberships for the current user', async () => {
    prismaService.userMembership.findMany.mockResolvedValue([
      membershipRecord,
      {
        ...membershipRecord,
        id: 'membership-2',
        status: 'EXPIRED',
        canRenew: false,
      },
    ]);

    const result = await membershipsService.getMyMemberships('user-1');

    expect(result.activeMemberships).toHaveLength(1);
    expect(result.completedMemberships).toHaveLength(1);
  });

  it('rejects freeze when membership is already frozen', async () => {
    prismaService.userMembership.findFirst.mockResolvedValue({
      ...membershipRecord,
      status: 'FROZEN',
      freezes: [
        {
          id: 'freeze-1',
          startsAt: new Date('2026-03-02T00:00:00.000Z'),
          endsAt: new Date('2099-03-09T00:00:00.000Z'),
          daysUsed: 7,
          status: 'ACTIVE',
          createdAt: new Date('2026-03-02T00:00:00.000Z'),
          updatedAt: new Date('2026-03-02T00:00:00.000Z'),
        },
      ],
    });

    await expect(
      membershipsService.freezeMembership('user-1', 'membership-1', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects freeze when no freeze days are left', async () => {
    prismaService.userMembership.findFirst.mockResolvedValue({
      ...membershipRecord,
      freezeDaysUsed: 30,
    });

    await expect(
      membershipsService.freezeMembership('user-1', 'membership-1', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('creates renewal request for a renewable membership', async () => {
    prismaService.userMembership.findFirst.mockResolvedValue(membershipRecord);
    prismaService.userMembership.findMany.mockResolvedValue([membershipRecord]);

    await membershipsService.requestRenewal('user-1', 'membership-1', {
      comment: 'Хочу продлить',
    });

    expect(
      prismaService.userMembershipRenewalRequest.create,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          membershipId: 'membership-1',
          userId: 'user-1',
          status: 'PENDING',
        }),
      }),
    );
  });

  it('prevents renewal of unavailable membership', async () => {
    prismaService.userMembership.findFirst.mockResolvedValue(null);

    await expect(
      membershipsService.requestRenewal('user-2', 'membership-1', {}),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('creates membership from admin payload', async () => {
    prismaService.passPlan.findUnique.mockResolvedValue({
      id: 'plan-1',
      title: 'Безлимит',
      subtitle: null,
      description: null,
    });
    prismaService.userMembership.findMany.mockResolvedValue([membershipRecord]);

    await membershipsService.createMembership({
      userId: 'user-1',
      passPlanId: 'plan-1',
      startsAt: '2026-03-01T00:00:00.000Z',
      endsAt: '2026-05-12T00:00:00.000Z',
      freezeDaysLimit: 30,
    });

    expect(prismaService.userMembership.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userId: 'user-1',
          passPlanId: 'plan-1',
          freezeDaysLimit: 30,
        }),
      }),
    );
  });
});
