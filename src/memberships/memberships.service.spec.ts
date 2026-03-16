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
    jest.useFakeTimers().setSystemTime(new Date('2026-05-05T00:00:00.000Z'));

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

  afterEach(() => {
    jest.useRealTimers();
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

  it('applies freeze immediately and extends membership end date', async () => {
    prismaService.userMembership.findFirst.mockResolvedValue(membershipRecord);
    prismaService.userMembership.findMany.mockResolvedValue([membershipRecord]);

    await membershipsService.freezeMembership('user-1', 'membership-1', { days: 5 });

    expect(prismaService.userMembershipFreeze.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          membershipId: 'membership-1',
          daysUsed: 5,
          status: 'ACTIVE',
        }),
      }),
    );
    expect(prismaService.userMembership.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'membership-1' },
        data: expect.objectContaining({
          status: 'FROZEN',
          freezeDaysUsed: 5,
          endsAt: new Date('2026-05-17T00:00:00.000Z'),
        }),
      }),
    );
  });

  it('rejects freeze for expired membership', async () => {
    prismaService.userMembership.findFirst.mockResolvedValue({
      ...membershipRecord,
      status: 'EXPIRED',
    });

    await expect(
      membershipsService.freezeMembership('user-1', 'membership-1', {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows user to unfreeze membership and return unused freeze days', async () => {
    prismaService.userMembership.findFirst.mockResolvedValue({
      ...membershipRecord,
      status: 'FROZEN',
      freezeDaysUsed: 7,
      endsAt: new Date('2026-05-19T00:00:00.000Z'),
      freezes: [
        {
          id: 'freeze-1',
          startsAt: new Date('2026-05-04T00:00:00.000Z'),
          endsAt: new Date('2026-05-11T00:00:00.000Z'),
          daysUsed: 7,
          status: 'ACTIVE',
          createdAt: new Date('2026-05-04T00:00:00.000Z'),
          updatedAt: new Date('2026-05-04T00:00:00.000Z'),
        },
      ],
    });
    prismaService.userMembership.findMany.mockResolvedValue([membershipRecord]);

    await membershipsService.unfreezeMembershipForUser('user-1', 'membership-1');

    expect(prismaService.userMembershipFreeze.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'freeze-1' },
        data: expect.objectContaining({
          status: 'COMPLETED',
          daysUsed: 1,
        }),
      }),
    );
    expect(prismaService.userMembership.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'membership-1' },
        data: expect.objectContaining({
          status: 'ACTIVE',
          endsAt: new Date('2026-05-13T00:00:00.000Z'),
          freezeDaysUsed: 1,
        }),
      }),
    );
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
