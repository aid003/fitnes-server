import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  MembershipFreezeStatus,
  MembershipRenewalStatus,
  MembershipStatus,
  Prisma,
} from '@prisma/client';
import { handlePrismaError } from '../common/database/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMembershipDto } from './dto/create-membership.dto';
import { CreateMembershipFreezeDto } from './dto/create-membership-freeze.dto';
import { CreateMembershipRenewalDto } from './dto/create-membership-renewal.dto';
import { UpdateMembershipDto } from './dto/update-membership.dto';

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_FREEZE_DAYS = 7;

const membershipSelect = {
  id: true,
  title: true,
  subtitle: true,
  description: true,
  startsAt: true,
  endsAt: true,
  status: true,
  freezeDaysLimit: true,
  freezeDaysUsed: true,
  canRenew: true,
  sortOrder: true,
  createdAt: true,
  updatedAt: true,
  user: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  passPlan: {
    select: {
      id: true,
      title: true,
      subtitle: true,
      description: true,
      features: {
        select: {
          id: true,
          label: true,
          icon: true,
          sortOrder: true,
        },
        orderBy: { sortOrder: 'asc' },
      },
    },
  },
  freezes: {
    orderBy: [{ createdAt: 'desc' }],
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      daysUsed: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  },
  renewalRequests: {
    orderBy: [{ createdAt: 'desc' }],
    select: {
      id: true,
      comment: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.UserMembershipSelect;

type MembershipRecord = Prisma.UserMembershipGetPayload<{
  select: typeof membershipSelect;
}>;

@Injectable()
export class MembershipsService {
  constructor(private readonly prisma: PrismaService) {}

  async getMyMemberships(userId: string) {
    await this.ensureUserExists(userId);

    const memberships = await this.prisma.userMembership.findMany({
      where: { userId },
      select: membershipSelect,
      orderBy: [{ sortOrder: 'asc' }, { startsAt: 'desc' }, { createdAt: 'desc' }],
    });

    const synced = await this.syncMembershipStates(memberships);
    const activeMemberships = synced
      .filter((membership) => isVisibleInActiveBlock(membership))
      .map((membership) => this.mapMembershipCard(membership));
    const completedMemberships = synced
      .filter((membership) => !isVisibleInActiveBlock(membership))
      .map((membership) => this.mapHistoryItem(membership));

    return {
      activeMemberships,
      completedMemberships,
    };
  }

  async freezeMembership(
    userId: string,
    membershipId: string,
    dto: CreateMembershipFreezeDto,
  ) {
    const membership = await this.getMembershipForUser(userId, membershipId);
    const synced = await this.syncMembershipState(membership);
    const activeFreeze = getActiveFreeze(synced);

    if (activeFreeze) {
      throw new BadRequestException('Membership is already frozen');
    }

    if (synced.status !== MembershipStatus.ACTIVE) {
      throw new BadRequestException('Only active memberships can be frozen');
    }

    const freezeDaysLeft = Math.max(
      0,
      synced.freezeDaysLimit - synced.freezeDaysUsed,
    );

    if (freezeDaysLeft <= 0) {
      throw new BadRequestException('No freeze days left');
    }

    const requestedDays = dto.days ?? DEFAULT_FREEZE_DAYS;
    const freezeDays = Math.min(requestedDays, freezeDaysLeft);
    const now = new Date();
    const freezeEndsAt = addDays(now, freezeDays);
    const nextEndsAt = addDays(synced.endsAt, freezeDays);

    await this.prisma.$transaction([
      this.prisma.userMembershipFreeze.create({
        data: {
          membershipId,
          startsAt: now,
          endsAt: freezeEndsAt,
          daysUsed: freezeDays,
          status: MembershipFreezeStatus.ACTIVE,
        },
      }),
      this.prisma.userMembership.update({
        where: { id: membershipId },
        data: {
          status: MembershipStatus.FROZEN,
          freezeDaysUsed: synced.freezeDaysUsed + freezeDays,
          endsAt: nextEndsAt,
        },
      }),
    ]);

    return this.getMyMemberships(userId);
  }

  async requestRenewal(
    userId: string,
    membershipId: string,
    dto: CreateMembershipRenewalDto,
  ) {
    const membership = await this.getMembershipForUser(userId, membershipId);
    const synced = await this.syncMembershipState(membership);

    if (!synced.canRenew) {
      throw new BadRequestException('Renewal is unavailable for this membership');
    }

    const hasPendingRequest = synced.renewalRequests.some(
      (request) => request.status === MembershipRenewalStatus.PENDING,
    );

    if (hasPendingRequest) {
      throw new BadRequestException('Renewal request already exists');
    }

    try {
      await this.prisma.userMembershipRenewalRequest.create({
        data: {
          membershipId: synced.id,
          userId,
          comment: dto.comment?.trim() || undefined,
          status: MembershipRenewalStatus.PENDING,
        },
      });
    } catch (error) {
      handlePrismaError(error, 'Membership renewal request');
    }

    return this.getMyMemberships(userId);
  }

  async listAdminMemberships() {
    const memberships = await this.prisma.userMembership.findMany({
      select: membershipSelect,
      orderBy: [{ createdAt: 'desc' }],
    });

    const synced = await this.syncMembershipStates(memberships);

    return synced.map((membership) => this.mapAdminMembership(membership));
  }

  async createMembership(dto: CreateMembershipDto) {
    await this.ensureUserExists(dto.userId);

    const passPlan = await this.prisma.passPlan.findUnique({
      where: { id: dto.passPlanId },
      select: {
        id: true,
        title: true,
        subtitle: true,
        description: true,
      },
    });

    if (!passPlan) {
      throw new NotFoundException('Pass plan not found');
    }

    const startsAt = parseDate(dto.startsAt, 'startsAt');
    const endsAt = parseDate(dto.endsAt, 'endsAt');

    if (startsAt >= endsAt) {
      throw new BadRequestException('endsAt must be later than startsAt');
    }

    const status =
      dto.status ?? (endsAt <= new Date() ? MembershipStatus.EXPIRED : MembershipStatus.ACTIVE);

    try {
      await this.prisma.userMembership.create({
        data: {
          userId: dto.userId,
          passPlanId: dto.passPlanId,
          title: dto.title?.trim() || passPlan.title,
          subtitle: dto.subtitle?.trim() || passPlan.subtitle || undefined,
          description: dto.description?.trim() || passPlan.description || undefined,
          startsAt,
          endsAt,
          status,
          freezeDaysLimit: dto.freezeDaysLimit ?? 0,
          canRenew: dto.canRenew ?? true,
          sortOrder: dto.sortOrder ?? 0,
        },
      });
    } catch (error) {
      handlePrismaError(error, 'User membership');
    }

    return this.listAdminMemberships();
  }

  async updateMembership(membershipId: string, dto: UpdateMembershipDto) {
    const membership = await this.prisma.userMembership.findUnique({
      where: { id: membershipId },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        freezeDaysLimit: true,
        freezeDaysUsed: true,
      },
    });

    if (!membership) {
      throw new NotFoundException('Membership not found');
    }

    const data: Prisma.UserMembershipUpdateInput = {};

    if (dto.startsAt) {
      data.startsAt = parseDate(dto.startsAt, 'startsAt');
    }

    if (dto.endsAt) {
      data.endsAt = parseDate(dto.endsAt, 'endsAt');
    }

    if (dto.status) {
      data.status = dto.status;
    }

    if (dto.freezeDaysLimit !== undefined) {
      if (dto.freezeDaysLimit < membership.freezeDaysUsed) {
        throw new BadRequestException('freezeDaysLimit cannot be less than used days');
      }

      data.freezeDaysLimit = dto.freezeDaysLimit;
    }

    if (dto.canRenew !== undefined) {
      data.canRenew = dto.canRenew;
    }

    if (dto.sortOrder !== undefined) {
      data.sortOrder = dto.sortOrder;
    }

    if (dto.title !== undefined) {
      data.title = dto.title.trim();
    }

    if (dto.subtitle !== undefined) {
      data.subtitle = dto.subtitle.trim() || null;
    }

    if (dto.description !== undefined) {
      data.description = dto.description.trim() || null;
    }

    const nextStartsAt = (data.startsAt as Date | undefined) ?? membership.startsAt;
    const nextEndsAt = (data.endsAt as Date | undefined) ?? membership.endsAt;

    if (nextStartsAt >= nextEndsAt) {
      throw new BadRequestException('endsAt must be later than startsAt');
    }

    await this.prisma.userMembership.update({
      where: { id: membershipId },
      data,
    });

    return this.listAdminMemberships();
  }

  async expireMembership(membershipId: string) {
    await this.ensureMembershipExists(membershipId);

    await this.prisma.$transaction([
      this.prisma.userMembership.update({
        where: { id: membershipId },
        data: {
          status: MembershipStatus.EXPIRED,
          endsAt: new Date(),
        },
      }),
      this.prisma.userMembershipFreeze.updateMany({
        where: {
          membershipId,
          status: MembershipFreezeStatus.ACTIVE,
        },
        data: {
          status: MembershipFreezeStatus.CANCELLED,
          endsAt: new Date(),
        },
      }),
    ]);

    return this.listAdminMemberships();
  }

  async unfreezeMembership(membershipId: string) {
    const membership = await this.prisma.userMembership.findUnique({
      where: { id: membershipId },
      select: membershipSelect,
    });

    if (!membership) {
      throw new NotFoundException('Membership not found');
    }

    const activeFreeze = getActiveFreeze(membership);

    if (!activeFreeze) {
      throw new BadRequestException('Membership has no active freeze');
    }

    const now = new Date();
    const actualDays = getUsedDays(activeFreeze.startsAt, now);
    const unusedDays = Math.max(0, activeFreeze.daysUsed - actualDays);
    const nextEndsAt = subtractDays(membership.endsAt, unusedDays);
    const nextStatus =
      nextEndsAt <= now ? MembershipStatus.EXPIRED : MembershipStatus.ACTIVE;

    await this.prisma.$transaction([
      this.prisma.userMembershipFreeze.update({
        where: { id: activeFreeze.id },
        data: {
          status: MembershipFreezeStatus.COMPLETED,
          endsAt: now,
          daysUsed: actualDays,
        },
      }),
      this.prisma.userMembership.update({
        where: { id: membershipId },
        data: {
          status: nextStatus,
          endsAt: nextEndsAt,
          freezeDaysUsed: Math.max(
            0,
            membership.freezeDaysUsed - unusedDays,
          ),
        },
      }),
    ]);

    return this.listAdminMemberships();
  }

  private async getMembershipForUser(userId: string, membershipId: string) {
    const membership = await this.prisma.userMembership.findFirst({
      where: {
        id: membershipId,
        userId,
      },
      select: membershipSelect,
    });

    if (!membership) {
      throw new ForbiddenException('Membership is unavailable');
    }

    return membership;
  }

  private async syncMembershipStates(memberships: MembershipRecord[]) {
    const result: MembershipRecord[] = [];

    for (const membership of memberships) {
      result.push(await this.syncMembershipState(membership));
    }

    return result;
  }

  private async syncMembershipState(membership: MembershipRecord) {
    const now = new Date();
    const activeFreeze = getActiveFreeze(membership);

    if (activeFreeze && activeFreeze.endsAt <= now) {
      const nextStatus =
        membership.endsAt <= now ? MembershipStatus.EXPIRED : MembershipStatus.ACTIVE;

      await this.prisma.$transaction([
        this.prisma.userMembershipFreeze.update({
          where: { id: activeFreeze.id },
          data: {
            status: MembershipFreezeStatus.COMPLETED,
          },
        }),
        this.prisma.userMembership.update({
          where: { id: membership.id },
          data: {
            status: nextStatus,
          },
        }),
      ]);

      return this.getMembershipById(membership.id);
    }

    if (!activeFreeze && membership.status === MembershipStatus.FROZEN) {
      const nextStatus =
        membership.endsAt <= now ? MembershipStatus.EXPIRED : MembershipStatus.ACTIVE;

      await this.prisma.userMembership.update({
        where: { id: membership.id },
        data: {
          status: nextStatus,
        },
      });

      return this.getMembershipById(membership.id);
    }

    if (membership.status !== MembershipStatus.EXPIRED && membership.endsAt <= now) {
      await this.prisma.userMembership.update({
        where: { id: membership.id },
        data: {
          status: MembershipStatus.EXPIRED,
        },
      });

      return this.getMembershipById(membership.id);
    }

    return membership;
  }

  private async getMembershipById(membershipId: string) {
    const membership = await this.prisma.userMembership.findUnique({
      where: { id: membershipId },
      select: membershipSelect,
    });

    if (!membership) {
      throw new NotFoundException('Membership not found');
    }

    return membership;
  }

  private mapMembershipCard(membership: MembershipRecord) {
    const pendingRenewal = membership.renewalRequests.find(
      (request) => request.status === MembershipRenewalStatus.PENDING,
    );
    const freezeDaysLeft = Math.max(
      0,
      membership.freezeDaysLimit - membership.freezeDaysUsed,
    );
    const daysLeft = getDaysLeft(membership.endsAt);
    const status = getStatusMeta(membership.status, pendingRenewal !== undefined);

    return {
      id: membership.id,
      title: membership.title,
      subtitle:
        membership.subtitle ??
        formatMembershipPeriod(membership.startsAt, membership.endsAt),
      startsAt: membership.startsAt.toISOString(),
      status: membership.status,
      statusLabel: status.label,
      statusTone: status.tone,
      expiresAt: membership.endsAt.toISOString(),
      daysLeft,
      freezeDaysLeft,
      features: membership.passPlan.features.map((feature) => ({
        id: feature.id,
        label: feature.label,
        icon: feature.icon,
      })),
      canFreeze:
        membership.status === MembershipStatus.ACTIVE &&
        freezeDaysLeft > 0 &&
        !getActiveFreeze(membership),
      canRenew: membership.canRenew && !pendingRenewal,
      scheduleAvailable: false,
      history: buildMembershipHistory(membership),
      pendingRenewal: Boolean(pendingRenewal),
    };
  }

  private mapHistoryItem(membership: MembershipRecord) {
    return {
      id: membership.id,
      title: membership.title,
      subtitle: formatMembershipPeriod(membership.startsAt, membership.endsAt),
      startsAt: membership.startsAt.toISOString(),
      status: membership.status,
      statusLabel: getStatusMeta(membership.status, false).label,
      statusTone: getStatusMeta(membership.status, false).tone,
      expiresAt: membership.endsAt.toISOString(),
      history: buildMembershipHistory(membership),
      features: membership.passPlan.features.map((feature) => ({
        id: feature.id,
        label: feature.label,
        icon: feature.icon,
      })),
    };
  }

  private mapAdminMembership(membership: MembershipRecord) {
    return {
      id: membership.id,
      title: membership.title,
      subtitle: membership.subtitle,
      description: membership.description,
      startsAt: membership.startsAt.toISOString(),
      endsAt: membership.endsAt.toISOString(),
      status: membership.status,
      freezeDaysLimit: membership.freezeDaysLimit,
      freezeDaysUsed: membership.freezeDaysUsed,
      canRenew: membership.canRenew,
      sortOrder: membership.sortOrder,
      user: membership.user,
      passPlan: {
        id: membership.passPlan.id,
        title: membership.passPlan.title,
        subtitle: membership.passPlan.subtitle,
      },
      freezes: membership.freezes.map((freeze) => ({
        ...freeze,
        startsAt: freeze.startsAt.toISOString(),
        endsAt: freeze.endsAt.toISOString(),
        createdAt: freeze.createdAt.toISOString(),
        updatedAt: freeze.updatedAt.toISOString(),
      })),
      renewalRequests: membership.renewalRequests.map((request) => ({
        ...request,
        createdAt: request.createdAt.toISOString(),
        updatedAt: request.updatedAt.toISOString(),
      })),
    };
  }

  private async ensureUserExists(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }
  }

  private async ensureMembershipExists(membershipId: string) {
    const membership = await this.prisma.userMembership.findUnique({
      where: { id: membershipId },
      select: { id: true },
    });

    if (!membership) {
      throw new NotFoundException('Membership not found');
    }
  }
}

function buildMembershipHistory(membership: MembershipRecord) {
  const entries = [
    {
      id: `period-${membership.id}`,
      label: `Период действия: ${formatMembershipPeriod(
        membership.startsAt,
        membership.endsAt,
      )}`,
      tone: 'default',
    },
  ];

  for (const freeze of membership.freezes) {
    entries.push({
      id: freeze.id,
      label: `Заморозка: ${formatMembershipPeriod(freeze.startsAt, freeze.endsAt)}`,
      tone:
        freeze.status === MembershipFreezeStatus.ACTIVE ? 'accent' : 'default',
    });
  }

  for (const request of membership.renewalRequests) {
    entries.push({
      id: request.id,
      label: `Продление: ${formatRenewalStatus(request.status)} ${formatDate(
        request.createdAt,
      )}`,
      tone:
        request.status === MembershipRenewalStatus.PENDING ? 'accent' : 'default',
    });
  }

  return entries;
}

function getStatusMeta(status: MembershipStatus, hasPendingRenewal: boolean) {
  if (hasPendingRenewal) {
    return {
      label: 'Заявка на продление',
      tone: 'warning',
    };
  }

  if (status === MembershipStatus.FROZEN) {
    return {
      label: 'Заморожен',
      tone: 'muted',
    };
  }

  if (status === MembershipStatus.EXPIRED) {
    return {
      label: 'Ваш абонемент закончился',
      tone: 'danger',
    };
  }

  return {
    label: 'Активен',
    tone: 'success',
  };
}

function isVisibleInActiveBlock(membership: MembershipRecord) {
  return (
    membership.status === MembershipStatus.ACTIVE ||
    membership.status === MembershipStatus.FROZEN ||
    (membership.status === MembershipStatus.EXPIRED && membership.canRenew)
  );
}

function getDaysLeft(endsAt: Date) {
  const diff = endsAt.getTime() - Date.now();

  if (diff <= 0) {
    return 0;
  }

  return Math.ceil(diff / DAY_IN_MS);
}

function getActiveFreeze(membership: Pick<MembershipRecord, 'freezes'>) {
  return membership.freezes.find(
    (freeze) => freeze.status === MembershipFreezeStatus.ACTIVE,
  );
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_IN_MS);
}

function subtractDays(date: Date, days: number) {
  return new Date(date.getTime() - days * DAY_IN_MS);
}

function getUsedDays(startsAt: Date, endsAt: Date) {
  const diff = Math.max(0, endsAt.getTime() - startsAt.getTime());

  return Math.ceil(diff / DAY_IN_MS);
}

function formatMembershipPeriod(startsAt: Date, endsAt: Date) {
  return `${formatDate(startsAt)} - ${formatDate(endsAt)}`;
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

function formatRenewalStatus(status: MembershipRenewalStatus) {
  if (status === MembershipRenewalStatus.PROCESSED) {
    return 'Продление обработано';
  }

  if (status === MembershipRenewalStatus.CANCELLED) {
    return 'Продление отменено';
  }

  return 'Заявка на продление';
}

function parseDate(value: string, fieldName: string) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${fieldName} must be a valid ISO date`);
  }

  return parsed;
}
