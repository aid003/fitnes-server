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
import { kopecksToRubles } from '../common/money/money';
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

type UsageMode = 'TERM' | 'VISIT';
type ActivationStatus = 'PENDING' | 'ACTIVATED';

const membershipSelect = {
  id: true,
  title: true,
  subtitle: true,
  description: true,
  issuedAt: true,
  activatedAt: true,
  startsAt: true,
  endsAt: true,
  status: true,
  billingType: true,
  durationValue: true,
  durationUnit: true,
  totalVisits: true,
  usedVisits: true,
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
      billingType: true,
      durationValue: true,
      durationUnit: true,
      visitCount: true,
      group: {
        select: {
          title: true,
          variant: {
            select: {
              title: true,
              category: {
                select: {
                  title: true,
                },
              },
            },
          },
        },
      },
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

type MembershipSnapshot = {
  billingType: BillingType | null;
  durationValue: number | null;
  durationUnit: DurationUnit | null;
  totalVisits: number | null;
};

type SnapshotCarrier = {
  billingType?: BillingType | null;
  durationValue?: number | null;
  durationUnit?: DurationUnit | null;
  totalVisits?: number | null;
  passPlan?: {
    billingType: BillingType | null;
    durationValue: number | null;
    durationUnit: DurationUnit | null;
    visitCount: number | null;
  };
};

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
        visitCount: true,
      },
    });

    if (!passPlan) {
      throw new NotFoundException('Pass plan not found');
    }

    const issuedAt = input.paidAt ?? new Date();

    return this.prisma.userMembership.create({
      data: {
        userId: input.userId,
        passPlanId: input.passPlanId,
        title: input.title?.trim() || passPlan.title,
        subtitle: input.subtitle?.trim() || passPlan.subtitle || undefined,
        description:
          input.description?.trim() || passPlan.description || undefined,
        issuedAt,
        activatedAt: null,
        startsAt: issuedAt,
        endsAt: issuedAt,
        status: MembershipStatus.PENDING_ACTIVATION,
        billingType: passPlan.billingType,
        durationValue: passPlan.durationValue,
        durationUnit: passPlan.durationUnit,
        totalVisits: passPlan.visitCount,
        usedVisits: 0,
        freezeDaysLimit: input.freezeDaysLimit ?? 0,
        canRenew: !isVisitBased(passPlan.billingType),
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
        { issuedAt: 'desc' },
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
        status: true,
        activatedAt: true,
        startsAt: true,
        endsAt: true,
        billingType: true,
        totalVisits: true,
        usedVisits: true,
        qrCodeSvg: true,
        qrGeneratedAt: true,
        qrPayload: true,
        paymentOrders: {
          select: {
            status: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
        },
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

    const latestPayment = membership.paymentOrders[0];

    if (
      membership.status === MembershipStatus.REFUNDED ||
      (!latestPayment || latestPayment.status !== PaymentOrderStatus.PAID)
    ) {
      throw new BadRequestException('QR code is no longer valid');
    }

    if (isMembershipExhausted(membership)) {
      throw new BadRequestException('QR code is no longer valid');
    }

    const payload = membership.qrPayload as MembershipQrPayload;

    return {
      membershipId: membership.id,
      qrCodeSvg: membership.qrCodeSvg,
      generatedAt: membership.qrGeneratedAt.toISOString(),
      payloadSummary: {
        customerName: payload.user.name,
        customerEmail: payload.user.email,
        planOrigin: formatPlanOriginParts(
          payload.plan.categoryTitle ?? null,
          payload.plan.variantTitle ?? null,
          payload.plan.groupTitle ?? null,
        ),
        planTitle: payload.plan.title,
        planSubtitle: payload.plan.subtitle,
        amount: payload.payment.amount,
        currency: payload.payment.currency,
        paidAt: payload.payment.paidAt,
        merchantOrderNumber: payload.payment.merchantOrderNumber,
        expiresAt: payload.membership.endsAt,
        membershipStateLabel: getMembershipStateLabelFromData({
          status: membership.status,
          billingType: membership.billingType,
          totalVisits: membership.totalVisits,
          usedVisits: membership.usedVisits,
          endsAt: membership.endsAt,
        }),
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
            visitCount: true,
            group: {
              select: {
                title: true,
                variant: {
                  select: {
                    title: true,
                    category: {
                      select: {
                        title: true,
                      },
                    },
                  },
                },
              },
            },
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
        issuedAt: true,
        activatedAt: true,
        startsAt: true,
        endsAt: true,
        billingType: true,
        durationValue: true,
        durationUnit: true,
        totalVisits: true,
        usedVisits: true,
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
        issuedAt: membership.issuedAt.toISOString(),
        activatedAt: membership.activatedAt?.toISOString() ?? null,
        startsAt:
          membership.activatedAt &&
          !isVisitBased(resolveSnapshot(membership).billingType)
          ? membership.startsAt.toISOString()
          : null,
        endsAt:
          membership.activatedAt &&
          !isVisitBased(resolveSnapshot(membership).billingType)
          ? membership.endsAt.toISOString()
          : null,
        freezeDaysLimit: membership.freezeDaysLimit,
        billingType: resolveSnapshot(membership).billingType,
        totalVisits: resolveSnapshot(membership).totalVisits,
        usedVisits: membership.usedVisits,
      },
      plan: {
        id: paymentOrder.passPlan.id,
        title: paymentOrder.passPlan.title ?? paymentOrder.planTitle,
        subtitle: paymentOrder.passPlan.subtitle ?? paymentOrder.planSubtitle,
        description:
          paymentOrder.passPlan.description ?? paymentOrder.planDescription,
        categoryTitle: paymentOrder.passPlan.group.variant.category.title,
        variantTitle: paymentOrder.passPlan.group.variant.title,
        groupTitle: paymentOrder.passPlan.group.title,
        billingType: paymentOrder.passPlan.billingType,
        durationValue: paymentOrder.passPlan.durationValue,
        durationUnit: paymentOrder.passPlan.durationUnit,
        visitCount: paymentOrder.passPlan.visitCount,
      },
      payment: {
        paymentId: paymentOrder.id,
        merchantOrderNumber: paymentOrder.merchantOrderNumber,
        gatewayOrderId: paymentOrder.gatewayOrderId,
        status: paymentOrder.status,
        amount: kopecksToRubles(paymentOrder.amount),
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

  async revokeMembershipAfterRefund(membershipId: string) {
    const membership = await this.prisma.userMembership.findUnique({
      where: { id: membershipId },
      select: {
        id: true,
        status: true,
        qrGeneratedAt: true,
        qrCodeSvg: true,
        qrSignature: true,
        freezes: {
          where: {
            status: MembershipFreezeStatus.ACTIVE,
          },
          select: {
            id: true,
          },
        },
      },
    });

    if (!membership) {
      return;
    }

    const hasActiveFreeze = membership.freezes.length > 0;
    const hasQrData = Boolean(
      membership.qrGeneratedAt || membership.qrCodeSvg || membership.qrSignature,
    );
    const alreadyRefunded = membership.status === MembershipStatus.REFUNDED;

    if (alreadyRefunded && !hasActiveFreeze && !hasQrData) {
      return;
    }

    await this.prisma.$transaction([
      this.prisma.userMembershipFreeze.updateMany({
        where: {
          membershipId,
          status: MembershipFreezeStatus.ACTIVE,
        },
        data: {
          status: MembershipFreezeStatus.CANCELLED,
        },
      }),
      this.prisma.userMembership.update({
        where: { id: membershipId },
        data: {
          status: MembershipStatus.REFUNDED,
          qrPayload: Prisma.JsonNull,
          qrSignature: null,
          qrCodeSvg: null,
          qrGeneratedAt: null,
        },
      }),
    ]);
  }

  async scanMembershipQr(content: string) {
    const envelope = this.membershipQrService.parseAndVerify(content);
    const payload = envelope.payload;
    const membership = await this.prisma.userMembership.findUnique({
      where: {
        id: payload.membershipId,
      },
      select: {
        id: true,
        title: true,
        subtitle: true,
        status: true,
        issuedAt: true,
        activatedAt: true,
        startsAt: true,
        endsAt: true,
        billingType: true,
        durationValue: true,
        durationUnit: true,
        totalVisits: true,
        usedVisits: true,
        freezeDaysLimit: true,
        paymentOrders: {
          select: {
            status: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 1,
        },
      },
    });

    if (!membership) {
      throw new BadRequestException(
        'QR-код недействителен: абонемент не найден или отозван.',
      );
    }

    const latestPayment = membership.paymentOrders[0];

    if (!latestPayment || latestPayment.status !== PaymentOrderStatus.PAID) {
      throw new BadRequestException(
        'QR-код недействителен: оплата отменена или возвращена.',
      );
    }

    if (membership.status === MembershipStatus.REFUNDED) {
      throw new BadRequestException(
        'QR-код недействителен: абонемент неактивен.',
      );
    }

    if (membership.status === MembershipStatus.FROZEN) {
      throw new BadRequestException(
        'Абонемент сейчас заморожен. Сначала снимите заморозку.',
      );
    }

    const snapshot = resolveSnapshot(membership);
    const usageMode = getUsageMode(snapshot.billingType);
    const totalVisits = snapshot.totalVisits;
    const now = new Date();
    const activationPerformed =
      membership.status === MembershipStatus.PENDING_ACTIVATION;

    if (
      usageMode === 'TERM' &&
      membership.status !== MembershipStatus.PENDING_ACTIVATION &&
      membership.endsAt <= now
    ) {
      await this.prisma.userMembership.update({
        where: { id: membership.id },
        data: { status: MembershipStatus.EXPIRED },
      });

      throw new BadRequestException('Срок действия абонемента уже закончился.');
    }

    if (
      usageMode === 'VISIT' &&
      totalVisits !== null &&
      membership.usedVisits >= totalVisits
    ) {
      await this.prisma.userMembership.update({
        where: { id: membership.id },
        data: { status: MembershipStatus.EXPIRED },
      });

      throw new BadRequestException('Все посещения по этому абонементу уже использованы.');
    }

    const nextStartsAt = activationPerformed ? now : membership.startsAt;
    const nextEndsAt = activationPerformed
      ? calculateEndsAtForActivation(now, snapshot)
      : membership.endsAt;

    let visitConsumed = false;
    let nextUsedVisits = membership.usedVisits;

    if (usageMode === 'VISIT') {
      visitConsumed = true;
      nextUsedVisits += 1;
    }

    const remainingVisits =
      totalVisits === null ? null : Math.max(0, totalVisits - nextUsedVisits);
    const shouldExpire =
      usageMode === 'VISIT'
        ? remainingVisits !== null && remainingVisits <= 0
        : nextEndsAt <= now;
    const nextStatus = shouldExpire
      ? MembershipStatus.EXPIRED
      : MembershipStatus.ACTIVE;

    const updated = await this.prisma.userMembership.update({
      where: { id: membership.id },
      data: {
        status: nextStatus,
        activatedAt: activationPerformed ? now : membership.activatedAt,
        startsAt: nextStartsAt,
        endsAt: nextEndsAt,
        usedVisits: nextUsedVisits,
      },
      select: {
        id: true,
        title: true,
        subtitle: true,
        status: true,
        issuedAt: true,
        activatedAt: true,
        startsAt: true,
        endsAt: true,
        billingType: true,
        durationValue: true,
        durationUnit: true,
        totalVisits: true,
        usedVisits: true,
        freezeDaysLimit: true,
      },
    });

    await this.attachQrSnapshotFromPayment(membership.id, payload.payment.paymentId);

    return {
      customer: {
        id: payload.user.id,
        name: payload.user.name,
        email: payload.user.email,
      },
      membership: {
        id: updated.id,
        title: updated.title,
        subtitle: updated.subtitle,
        status: updated.status,
        activationStatus:
          updated.status === MembershipStatus.PENDING_ACTIVATION
            ? 'PENDING'
            : 'ACTIVATED',
        issuedAt: updated.issuedAt.toISOString(),
        activatedAt: updated.activatedAt?.toISOString() ?? null,
        startsAt:
          usageMode === 'TERM' ? updated.startsAt.toISOString() : null,
        endsAt: usageMode === 'TERM' ? updated.endsAt.toISOString() : null,
        freezeDaysLimit: updated.freezeDaysLimit,
        billingType: snapshot.billingType,
        totalVisits,
        usedVisits: updated.usedVisits,
        remainingVisits,
      },
      plan: {
        ...payload.plan,
      },
      payment: payload.payment,
      verification: {
        isSignatureValid: true,
        version: envelope.version,
        generatedAt: payload.generatedAt,
      },
      activationPerformed,
      visitConsumed,
      remainingVisits,
      membershipStateLabel: getMembershipStateLabelFromData({
        status: updated.status,
        billingType: updated.billingType,
        totalVisits,
        usedVisits: updated.usedVisits,
        endsAt: updated.endsAt,
      }),
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

    if (getUsageMode(resolveSnapshot(synced).billingType) === 'VISIT') {
      throw new BadRequestException(
        'Абонементы по посещениям нельзя замораживать по дням.',
      );
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
        billingType: true,
        durationValue: true,
        durationUnit: true,
        visitCount: true,
      },
    });

    if (!passPlan) {
      throw new NotFoundException('Pass plan not found');
    }

    const issuedAt = new Date();
    const startsAt = dto.startsAt ? parseDate(dto.startsAt, 'startsAt') : issuedAt;
    const endsAt = dto.endsAt
      ? parseDate(dto.endsAt, 'endsAt')
      : calculateEndsAtForActivation(issuedAt, {
          billingType: passPlan.billingType,
          durationValue: passPlan.durationValue,
          durationUnit: passPlan.durationUnit,
          totalVisits: passPlan.visitCount,
        });

    if (startsAt > endsAt) {
      throw new BadRequestException('endsAt must be later than startsAt');
    }

    const hasManualPeriod = Boolean(dto.startsAt && dto.endsAt);
    const defaultStatus = hasManualPeriod
      ? endsAt <= new Date()
        ? MembershipStatus.EXPIRED
        : MembershipStatus.ACTIVE
      : MembershipStatus.PENDING_ACTIVATION;

    try {
      await this.prisma.userMembership.create({
        data: {
          userId: dto.userId,
          passPlanId: dto.passPlanId,
          title: dto.title?.trim() || passPlan.title,
          subtitle: dto.subtitle?.trim() || passPlan.subtitle || undefined,
          description:
            dto.description?.trim() || passPlan.description || undefined,
          issuedAt,
          activatedAt: hasManualPeriod ? startsAt : null,
          startsAt,
          endsAt,
          status: dto.status ?? defaultStatus,
          billingType: passPlan.billingType,
          durationValue: passPlan.durationValue,
          durationUnit: passPlan.durationUnit,
          totalVisits: passPlan.visitCount,
          usedVisits: 0,
          freezeDaysLimit: dto.freezeDaysLimit ?? 0,
          canRenew: dto.canRenew ?? !isVisitBased(passPlan.billingType),
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
        activatedAt: true,
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

    if (nextStartsAt > nextEndsAt) {
      throw new BadRequestException('endsAt must be later than startsAt');
    }

    if (membership.activatedAt && (dto.startsAt || dto.endsAt)) {
      data.activatedAt = nextStartsAt;
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
    const snapshot = resolveSnapshot(membership);
    const usageMode = getUsageMode(snapshot.billingType);

    if (
      membership.status === MembershipStatus.REFUNDED ||
      membership.status === MembershipStatus.PENDING_ACTIVATION
    ) {
      return membership;
    }

    if (
      usageMode === 'VISIT' &&
      snapshot.totalVisits !== null &&
      membership.usedVisits >= snapshot.totalVisits &&
      membership.status !== MembershipStatus.EXPIRED
    ) {
      await this.prisma.userMembership.update({
        where: { id: membership.id },
        data: {
          status: MembershipStatus.EXPIRED,
        },
      });

      return this.getMembershipById(membership.id);
    }

    if (usageMode === 'VISIT') {
      return membership;
    }

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
    const snapshot = resolveSnapshot(membership);
    const usageMode = getUsageMode(snapshot.billingType);
    const freezeDaysLeft = Math.max(
      0,
      membership.freezeDaysLimit - membership.freezeDaysUsed,
    );
    const remainingVisits = getRemainingVisits(membership, snapshot);
    const renewalAvailable =
      usageMode === 'TERM' &&
      membership.status !== MembershipStatus.PENDING_ACTIVATION &&
      membership.canRenew &&
      canRequestRenewalNow(membership);
    const status = getStatusMeta(membership.status, renewalAvailable);

    return {
      id: membership.id,
      title: membership.title,
      subtitle:
        membership.subtitle ??
        formatMembershipSubtitle(membership, usageMode, snapshot),
      planOrigin: formatPlanOriginFromMembership(membership),
      issuedAt: membership.issuedAt.toISOString(),
      activatedAt: membership.activatedAt?.toISOString() ?? null,
      startsAt:
        usageMode === 'TERM' && membership.status !== MembershipStatus.PENDING_ACTIVATION
          ? membership.startsAt.toISOString()
          : null,
      status: membership.status,
      activationStatus:
        membership.status === MembershipStatus.PENDING_ACTIVATION
          ? 'PENDING'
          : 'ACTIVATED',
      statusLabel: status.label,
      statusTone: status.tone,
      billingType: snapshot.billingType,
      usageMode,
      expiresAt:
        usageMode === 'TERM' && membership.status !== MembershipStatus.PENDING_ACTIVATION
          ? membership.endsAt.toISOString()
          : null,
      daysLeft:
        usageMode === 'TERM' && membership.status !== MembershipStatus.PENDING_ACTIVATION
          ? getDaysLeft(membership.endsAt)
          : null,
      totalVisits: snapshot.totalVisits,
      usedVisits: membership.usedVisits,
      remainingVisits,
      freezeDaysLeft,
      features: membership.passPlan.features.map((feature) => ({
        id: feature.id,
        label: feature.label,
        icon: feature.icon,
      })),
      canFreeze:
        usageMode === 'TERM' &&
        membership.status === MembershipStatus.ACTIVE &&
        freezeDaysLeft > 0 &&
        !getActiveFreeze(membership),
      canUnfreeze:
        usageMode === 'TERM' &&
        membership.status === MembershipStatus.FROZEN &&
        Boolean(getActiveFreeze(membership)),
      canRenew: membership.canRenew && usageMode === 'TERM',
      canRequestRenewalNow: renewalAvailable,
      scheduleAvailable: false,
      hasQr:
        membership.status !== MembershipStatus.REFUNDED &&
        Boolean(membership.qrGeneratedAt),
      history: buildMembershipHistory(membership),
    };
  }

  private mapHistoryItem(membership: MembershipRecord) {
    const snapshot = resolveSnapshot(membership);
    const usageMode = getUsageMode(snapshot.billingType);
    const status = getStatusMeta(membership.status, false);

    return {
      id: membership.id,
      title: membership.title,
      subtitle: formatMembershipSubtitle(membership, usageMode, snapshot),
      planOrigin: formatPlanOriginFromMembership(membership),
      issuedAt: membership.issuedAt.toISOString(),
      activatedAt: membership.activatedAt?.toISOString() ?? null,
      startsAt:
        usageMode === 'TERM' && membership.activatedAt
          ? membership.startsAt.toISOString()
          : null,
      status: membership.status,
      activationStatus:
        membership.status === MembershipStatus.PENDING_ACTIVATION
          ? 'PENDING'
          : 'ACTIVATED',
      statusLabel: status.label,
      statusTone: status.tone,
      billingType: snapshot.billingType,
      usageMode,
      expiresAt:
        usageMode === 'TERM' && membership.activatedAt
          ? membership.endsAt.toISOString()
          : null,
      totalVisits: snapshot.totalVisits,
      usedVisits: membership.usedVisits,
      remainingVisits: getRemainingVisits(membership, snapshot),
      hasQr:
        membership.status !== MembershipStatus.REFUNDED &&
        Boolean(membership.qrGeneratedAt),
      history: buildMembershipHistory(membership),
      features: membership.passPlan.features.map((feature) => ({
        id: feature.id,
        label: feature.label,
        icon: feature.icon,
      })),
    };
  }

  private mapAdminMembership(membership: MembershipRecord) {
    const snapshot = resolveSnapshot(membership);
    const usageMode = getUsageMode(snapshot.billingType);

    return {
      id: membership.id,
      title: membership.title,
      subtitle: membership.subtitle,
      description: membership.description,
      issuedAt: membership.issuedAt.toISOString(),
      activatedAt: membership.activatedAt?.toISOString() ?? null,
      startsAt: membership.startsAt.toISOString(),
      endsAt: membership.endsAt.toISOString(),
      status: membership.status,
      activationStatus:
        membership.status === MembershipStatus.PENDING_ACTIVATION
          ? 'PENDING'
          : 'ACTIVATED',
      billingType: snapshot.billingType,
      usageMode,
      totalVisits: snapshot.totalVisits,
      usedVisits: membership.usedVisits,
      remainingVisits: getRemainingVisits(membership, snapshot),
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

function resolveSnapshot(membership: SnapshotCarrier): MembershipSnapshot {
  const billingType = membership.billingType ?? membership.passPlan?.billingType ?? null;
  const durationValue =
    membership.durationValue ?? membership.passPlan?.durationValue ?? null;
  const durationUnit =
    membership.durationUnit ?? membership.passPlan?.durationUnit ?? null;
  const totalVisits = membership.totalVisits ?? membership.passPlan?.visitCount ?? null;

  return {
    billingType,
    durationValue,
    durationUnit,
    totalVisits,
  };
}

function isVisitBased(billingType: BillingType | null) {
  return (
    billingType === BillingType.SINGLE_VISIT ||
    billingType === BillingType.VISIT_PACK
  );
}

function getUsageMode(billingType: BillingType | null): UsageMode {
  return isVisitBased(billingType) ? 'VISIT' : 'TERM';
}

function getRemainingVisits(
  membership: Pick<MembershipRecord, 'usedVisits'>,
  snapshot: MembershipSnapshot,
) {
  if (snapshot.totalVisits === null) {
    return null;
  }

  return Math.max(0, snapshot.totalVisits - membership.usedVisits);
}

function isMembershipExhausted(
  membership: Pick<MembershipRecord, 'billingType' | 'totalVisits' | 'usedVisits'>,
) {
  const snapshot = resolveSnapshot(membership);

  return (
    snapshot.totalVisits !== null &&
    membership.usedVisits >= snapshot.totalVisits
  );
}

function formatPlanOriginFromMembership(membership: MembershipRecord) {
  return formatPlanOriginParts(
    membership.passPlan.group.variant.category.title,
    membership.passPlan.group.variant.title,
    membership.passPlan.group.title,
  );
}

function formatPlanOriginParts(
  categoryTitle: string | null,
  variantTitle: string | null,
  groupTitle: string | null,
) {
  const parts = [categoryTitle, variantTitle, groupTitle].filter(Boolean);

  return parts.length > 0 ? parts.join(' / ') : null;
}

function buildMembershipHistory(membership: MembershipRecord) {
  const snapshot = resolveSnapshot(membership);
  const usageMode = getUsageMode(snapshot.billingType);
  const entries: Array<{
    id: string;
    label: string;
    tone: 'default' | 'accent';
  }> = [
    {
      id: `issued-${membership.id}`,
      label: `Выдан: ${formatDateTimeLabel(membership.issuedAt)}`,
      tone: 'default' as const,
    },
  ];

  if (membership.activatedAt) {
    entries.push({
      id: `activated-${membership.id}`,
      label: `Активирован: ${formatDateTimeLabel(membership.activatedAt)}`,
      tone: 'accent' as const,
    });
  }

  if (usageMode === 'TERM' && membership.activatedAt) {
    entries.push({
      id: `period-${membership.id}`,
      label: `Период действия: ${formatMembershipPeriod(
        membership.startsAt,
        membership.endsAt,
      )}`,
      tone: 'default' as const,
    });
  }

  if (usageMode === 'VISIT' && snapshot.totalVisits !== null) {
    entries.push({
      id: `visits-${membership.id}`,
      label: `Посещений использовано: ${membership.usedVisits} из ${snapshot.totalVisits}`,
      tone: 'default' as const,
    });
  }

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

function formatMembershipSubtitle(
  membership: MembershipRecord,
  usageMode: UsageMode,
  snapshot: MembershipSnapshot,
) {
  if (membership.status === MembershipStatus.PENDING_ACTIVATION) {
    return 'Активируется при первом сканировании в клубе';
  }

  if (usageMode === 'VISIT' && snapshot.totalVisits !== null) {
    return `Осталось посещений: ${Math.max(
      0,
      snapshot.totalVisits - membership.usedVisits,
    )}`;
  }

  return formatMembershipPeriod(membership.startsAt, membership.endsAt);
}

function getMembershipStateLabel(membership: MembershipRecord) {
  const snapshot = resolveSnapshot(membership);
  const usageMode = getUsageMode(snapshot.billingType);

  if (membership.status === MembershipStatus.PENDING_ACTIVATION) {
    return 'Ожидает активации в клубе';
  }

  if (membership.status === MembershipStatus.FROZEN) {
    return 'Заморожен';
  }

  if (membership.status === MembershipStatus.REFUNDED) {
    return 'Возврат оформлен';
  }

  if (membership.status === MembershipStatus.EXPIRED && usageMode === 'VISIT') {
    return 'Посещения закончились';
  }

  if (membership.status === MembershipStatus.EXPIRED) {
    return 'Срок действия закончился';
  }

  if (usageMode === 'VISIT') {
    const remainingVisits = getRemainingVisits(membership, snapshot);
    return `Осталось посещений: ${remainingVisits ?? 0}`;
  }

  return `Действует до ${formatDate(membership.endsAt)}`;
}

function getMembershipStateLabelFromData(input: {
  status: MembershipStatus;
  billingType: BillingType | null;
  totalVisits: number | null;
  usedVisits: number;
  endsAt: Date;
}) {
  if (input.status === MembershipStatus.PENDING_ACTIVATION) {
    return 'Ожидает активации в клубе';
  }

  if (input.status === MembershipStatus.FROZEN) {
    return 'Заморожен';
  }

  if (input.status === MembershipStatus.REFUNDED) {
    return 'Возврат оформлен';
  }

  if (isVisitBased(input.billingType)) {
    const remainingVisits =
      input.totalVisits === null
        ? null
        : Math.max(0, input.totalVisits - input.usedVisits);

    if (input.status === MembershipStatus.EXPIRED) {
      return 'Посещения закончились';
    }

    return `Осталось посещений: ${remainingVisits ?? 0}`;
  }

  if (input.status === MembershipStatus.EXPIRED) {
    return 'Срок действия закончился';
  }

  return `Действует до ${formatDate(input.endsAt)}`;
}

function getStatusMeta(status: MembershipStatus, canRequestRenewal: boolean) {
  if (status === MembershipStatus.PENDING_ACTIVATION) {
    return {
      label: 'Ожидает активации',
      tone: 'warning',
    } as const;
  }

  if (status === MembershipStatus.REFUNDED) {
    return {
      label: 'Возврат оформлен',
      tone: 'muted',
    } as const;
  }

  if (status === MembershipStatus.FROZEN) {
    return {
      label: 'Заморожен',
      tone: 'muted',
    } as const;
  }

  if (status === MembershipStatus.EXPIRED && canRequestRenewal) {
    return {
      label: 'Доступно продление',
      tone: 'warning',
    } as const;
  }

  if (status === MembershipStatus.EXPIRED) {
    return {
      label: 'Абонемент завершён',
      tone: 'danger',
    } as const;
  }

  return {
    label: 'Активен',
    tone: 'success',
  } as const;
}

function isVisibleInActiveBlock(membership: MembershipRecord) {
  const snapshot = resolveSnapshot(membership);

  return (
    membership.status === MembershipStatus.PENDING_ACTIVATION ||
    membership.status === MembershipStatus.ACTIVE ||
    membership.status === MembershipStatus.FROZEN ||
    (getUsageMode(snapshot.billingType) === 'TERM' &&
      membership.status === MembershipStatus.EXPIRED &&
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

function formatDateTimeLabel(date: Date) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function parseDate(value: string, fieldName: string) {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${fieldName} must be a valid ISO date`);
  }

  return parsed;
}

function calculateEndsAtForActivation(
  startsAt: Date,
  snapshot: MembershipSnapshot,
) {
  if (snapshot.billingType === BillingType.SINGLE_VISIT) {
    return startsAt;
  }

  if (snapshot.billingType === BillingType.VISIT_PACK) {
    return startsAt;
  }

  if (snapshot.durationValue && snapshot.durationUnit) {
    return addDuration(startsAt, snapshot.durationValue, snapshot.durationUnit);
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
