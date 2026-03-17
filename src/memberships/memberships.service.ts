import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingType,
  DurationUnit,
  MembershipFreezeStatus,
  MembershipStatus,
  PaymentOrderStatus,
  Prisma,
} from '@prisma/client';
import { handlePrismaError } from '../common/database/prisma-errors';
import { PrismaService } from '../prisma/prisma.service';
import { CreateMembershipDto } from './dto/create-membership.dto';
import { CreateMembershipFreezeDto } from './dto/create-membership-freeze.dto';
import {
  MembershipQrPayload,
  MembershipQrService,
} from './membership-qr.service';
import { UpdateMembershipDto } from './dto/update-membership.dto';

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_FREEZE_DAYS = 7;
const RENEWAL_WINDOW_DAYS = 14;

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
  qrGeneratedAt: true,
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly membershipQrService: MembershipQrService,
  ) {}

  async issueMembershipFromPayment(input: {
    userId: string;
    passPlanId: string;
    paidAt?: Date;
    title?: string;
    subtitle?: string | null;
    description?: string | null;
    freezeDaysLimit?: number;
  }) {
    await this.ensureUserExists(input.userId);

    const passPlan = await this.prisma.passPlan.findUnique({
      where: { id: input.passPlanId },
      select: {
        id: true,
        title: true,
        subtitle: true,
        description: true,
        durationValue: true,
        durationUnit: true,
        billingType: true,
      },
    });

    if (!passPlan) {
      throw new NotFoundException('Pass plan not found');
    }

    const startsAt = input.paidAt ?? new Date();
    const endsAt = calculateMembershipEndsAt(startsAt, passPlan);

    return this.prisma.userMembership.create({
      data: {
        userId: input.userId,
        passPlanId: input.passPlanId,
        title: input.title?.trim() || passPlan.title,
        subtitle: input.subtitle?.trim() || passPlan.subtitle || undefined,
        description:
          input.description?.trim() || passPlan.description || undefined,
        startsAt,
        endsAt,
        status:
          endsAt <= new Date()
            ? MembershipStatus.EXPIRED
            : MembershipStatus.ACTIVE,
        freezeDaysLimit: input.freezeDaysLimit ?? 0,
        canRenew: true,
        sortOrder: 0,
      },
      select: {
        id: true,
      },
    });
  }

  async getMyMemberships(userId: string) {
    await this.ensureUserExists(userId);

    const memberships = await this.prisma.userMembership.findMany({
      where: { userId },
      select: membershipSelect,
      orderBy: [
        { sortOrder: 'asc' },
        { startsAt: 'desc' },
        { createdAt: 'desc' },
      ],
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

  async getMembershipQr(userId: string, membershipId: string) {
    const membership = await this.prisma.userMembership.findFirst({
      where: {
        id: membershipId,
        userId,
      },
      select: {
        id: true,
        qrCodeSvg: true,
        qrGeneratedAt: true,
        qrPayload: true,
      },
    });

    if (!membership) {
      throw new ForbiddenException('Membership is unavailable');
    }

    if (
      !membership.qrCodeSvg ||
      !membership.qrGeneratedAt ||
      !membership.qrPayload
    ) {
      throw new NotFoundException(
        'QR code is not available for this membership',
      );
    }

    const payload = membership.qrPayload as MembershipQrPayload;

    return {
      membershipId: membership.id,
      qrCodeSvg: membership.qrCodeSvg,
      generatedAt: membership.qrGeneratedAt.toISOString(),
      payloadSummary: {
        customerName: payload.user.name,
        customerEmail: payload.user.email,
        planTitle: payload.plan.title,
        planSubtitle: payload.plan.subtitle,
        amount: payload.payment.amount,
        currency: payload.payment.currency,
        paidAt: payload.payment.paidAt,
        merchantOrderNumber: payload.payment.merchantOrderNumber,
        expiresAt: payload.membership.endsAt,
      },
    };
  }

  async attachQrSnapshotFromPayment(
    membershipId: string,
    paymentOrderId: string,
  ) {
    const paymentOrder = await this.prisma.paymentOrder.findUnique({
      where: { id: paymentOrderId },
      select: {
        id: true,
        merchantOrderNumber: true,
        gatewayOrderId: true,
        status: true,
        amount: true,
        currency: true,
        createdAt: true,
        paidAt: true,
        membershipIssuedAt: true,
        actionCode: true,
        actionCodeDescription: true,
        planTitle: true,
        planSubtitle: true,
        planDescription: true,
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
            billingType: true,
            durationValue: true,
            durationUnit: true,
          },
        },
      },
    });

    const membership = await this.prisma.userMembership.findUnique({
      where: { id: membershipId },
      select: {
        id: true,
        title: true,
        subtitle: true,
        status: true,
        startsAt: true,
        endsAt: true,
        freezeDaysLimit: true,
        qrGeneratedAt: true,
      },
    });

    if (!paymentOrder || !membership) {
      throw new NotFoundException('Membership or payment order not found');
    }

    if (paymentOrder.status !== PaymentOrderStatus.PAID) {
      throw new BadRequestException(
        'QR code is available only for paid orders',
      );
    }

    if (membership.qrGeneratedAt) {
      return;
    }

    const generatedAt = new Date();
    const payload: MembershipQrPayload = {
      membershipId: membership.id,
      user: {
        id: paymentOrder.user.id,
        name: paymentOrder.user.name,
        email: paymentOrder.user.email,
      },
      membership: {
        title: membership.title,
        subtitle: membership.subtitle,
        status: membership.status,
        startsAt: membership.startsAt.toISOString(),
        endsAt: membership.endsAt.toISOString(),
        freezeDaysLimit: membership.freezeDaysLimit,
      },
      plan: {
        id: paymentOrder.passPlan.id,
        title: paymentOrder.passPlan.title ?? paymentOrder.planTitle,
        subtitle: paymentOrder.passPlan.subtitle ?? paymentOrder.planSubtitle,
        description:
          paymentOrder.passPlan.description ?? paymentOrder.planDescription,
        billingType: paymentOrder.passPlan.billingType,
        durationValue: paymentOrder.passPlan.durationValue,
        durationUnit: paymentOrder.passPlan.durationUnit,
      },
      payment: {
        paymentId: paymentOrder.id,
        merchantOrderNumber: paymentOrder.merchantOrderNumber,
        gatewayOrderId: paymentOrder.gatewayOrderId,
        status: paymentOrder.status,
        amount: paymentOrder.amount,
        currency: paymentOrder.currency,
        createdAt: paymentOrder.createdAt.toISOString(),
        paidAt: paymentOrder.paidAt?.toISOString() ?? null,
        membershipIssuedAt:
          paymentOrder.membershipIssuedAt?.toISOString() ?? null,
        actionCode: paymentOrder.actionCode,
        actionCodeDescription: paymentOrder.actionCodeDescription,
      },
      generatedAt: generatedAt.toISOString(),
    };
    const envelope = await this.membershipQrService.createEnvelope(payload);

    await this.prisma.userMembership.update({
      where: { id: membershipId },
      data: {
        qrPayload: payload,
        qrSignature: envelope.signature,
        qrCodeSvg: envelope.qrCodeSvg,
        qrGeneratedAt: generatedAt,
      },
    });
  }

  scanMembershipQr(content: string) {
    const envelope = this.membershipQrService.parseAndVerify(content);
    const payload = envelope.payload;

    return {
      customer: {
        id: payload.user.id,
        name: payload.user.name,
        email: payload.user.email,
      },
      membership: {
        id: payload.membershipId,
        title: payload.membership.title,
        subtitle: payload.membership.subtitle,
        status: payload.membership.status,
        startsAt: payload.membership.startsAt,
        endsAt: payload.membership.endsAt,
        freezeDaysLimit: payload.membership.freezeDaysLimit,
      },
      plan: payload.plan,
      payment: payload.payment,
      verification: {
        isSignatureValid: true,
        version: envelope.version,
        generatedAt: payload.generatedAt,
      },
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
      dto.status ??
      (endsAt <= new Date()
        ? MembershipStatus.EXPIRED
        : MembershipStatus.ACTIVE);

    try {
      await this.prisma.userMembership.create({
        data: {
          userId: dto.userId,
          passPlanId: dto.passPlanId,
          title: dto.title?.trim() || passPlan.title,
          subtitle: dto.subtitle?.trim() || passPlan.subtitle || undefined,
          description:
            dto.description?.trim() || passPlan.description || undefined,
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
        throw new BadRequestException(
          'freezeDaysLimit cannot be less than used days',
        );
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

    const nextStartsAt =
      (data.startsAt as Date | undefined) ?? membership.startsAt;
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

    await this.unfreezeMembershipRecord(membership);

    return this.listAdminMemberships();
  }

  async unfreezeMembershipForUser(userId: string, membershipId: string) {
    const membership = await this.getMembershipForUser(userId, membershipId);
    const synced = await this.syncMembershipState(membership);

    await this.unfreezeMembershipRecord(synced);

    return this.getMyMemberships(userId);
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
        membership.endsAt <= now
          ? MembershipStatus.EXPIRED
          : MembershipStatus.ACTIVE;

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
        membership.endsAt <= now
          ? MembershipStatus.EXPIRED
          : MembershipStatus.ACTIVE;

      await this.prisma.userMembership.update({
        where: { id: membership.id },
        data: {
          status: nextStatus,
        },
      });

      return this.getMembershipById(membership.id);
    }

    if (
      membership.status !== MembershipStatus.EXPIRED &&
      membership.endsAt <= now
    ) {
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

  private async unfreezeMembershipRecord(membership: MembershipRecord) {
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
        where: { id: membership.id },
        data: {
          status: nextStatus,
          endsAt: nextEndsAt,
          freezeDaysUsed: Math.max(0, membership.freezeDaysUsed - unusedDays),
        },
      }),
    ]);
  }

  private mapMembershipCard(membership: MembershipRecord) {
    const freezeDaysLeft = Math.max(
      0,
      membership.freezeDaysLimit - membership.freezeDaysUsed,
    );
    const daysLeft = getDaysLeft(membership.endsAt);
    const renewalAvailable =
      membership.canRenew && canRequestRenewalNow(membership);
    const status = getStatusMeta(membership.status, renewalAvailable);

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
      canUnfreeze:
        membership.status === MembershipStatus.FROZEN &&
        Boolean(getActiveFreeze(membership)),
      canRenew: membership.canRenew,
      canRequestRenewalNow: renewalAvailable,
      scheduleAvailable: false,
      hasQr: Boolean(membership.qrGeneratedAt),
      history: buildMembershipHistory(membership),
    };
  }

  private mapHistoryItem(membership: MembershipRecord) {
    const status = getStatusMeta(membership.status, false);

    return {
      id: membership.id,
      title: membership.title,
      subtitle: formatMembershipPeriod(membership.startsAt, membership.endsAt),
      startsAt: membership.startsAt.toISOString(),
      status: membership.status,
      statusLabel: status.label,
      statusTone: status.tone,
      expiresAt: membership.endsAt.toISOString(),
      hasQr: Boolean(membership.qrGeneratedAt),
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

  return entries;
}

function getStatusMeta(status: MembershipStatus, canRequestRenewal: boolean) {
  if (status === MembershipStatus.FROZEN) {
    return {
      label: 'Заморожен',
      tone: 'muted',
    };
  }

  if (status === MembershipStatus.EXPIRED && canRequestRenewal) {
    return {
      label: 'Доступно продление',
      tone: 'warning',
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
    (membership.status === MembershipStatus.EXPIRED &&
      membership.canRenew &&
      canRequestRenewalNow(membership))
  );
}

function canRequestRenewalNow(
  membership: Pick<MembershipRecord, 'endsAt' | 'canRenew'>,
) {
  if (!membership.canRenew) {
    return false;
  }

  return (
    membership.endsAt.getTime() - Date.now() <= RENEWAL_WINDOW_DAYS * DAY_IN_MS
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
  const now = new Date();

  return membership.freezes.find(
    (freeze) =>
      freeze.status === MembershipFreezeStatus.ACTIVE ||
      (freeze.status !== MembershipFreezeStatus.CANCELLED &&
        freeze.endsAt > now),
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

function parseDate(value: string, fieldName: string) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${fieldName} must be a valid ISO date`);
  }

  return parsed;
}

function calculateMembershipEndsAt(
  startsAt: Date,
  passPlan: {
    durationValue: number | null;
    durationUnit: DurationUnit | null;
    billingType: BillingType | null;
  },
) {
  if (passPlan.durationValue && passPlan.durationUnit) {
    return addDuration(startsAt, passPlan.durationValue, passPlan.durationUnit);
  }

  if (passPlan.billingType === BillingType.SINGLE_VISIT) {
    return addDays(startsAt, 1);
  }

  if (passPlan.billingType === BillingType.VISIT_PACK) {
    return addMonths(startsAt, 1);
  }

  return addMonths(startsAt, 1);
}

function addDuration(date: Date, value: number, unit: DurationUnit) {
  switch (unit) {
    case DurationUnit.DAY:
      return addDays(date, value);
    case DurationUnit.WEEK:
      return addDays(date, value * 7);
    case DurationUnit.MONTH:
      return addMonths(date, value);
    case DurationUnit.YEAR:
      return addYears(date, value);
  }
}

function addMonths(date: Date, months: number) {
  const nextDate = new Date(date);
  nextDate.setMonth(nextDate.getMonth() + months);

  return nextDate;
}

function addYears(date: Date, years: number) {
  const nextDate = new Date(date);
  nextDate.setFullYear(nextDate.getFullYear() + years);

  return nextDate;
}
