import {
  BadGatewayException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentOrderStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  kopecksToRubles,
  toGatewayAmount,
} from '../common/money/money';
import { MembershipsService } from '../memberships/memberships.service';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_SESSION_TIMEOUT_SECS = 20 * 60;
const ALFA_LANGUAGE = 'ru';
const ALFA_CURRENCY_CODE = '810';

const paymentSelect = {
  id: true,
  userId: true,
  passPlanId: true,
  membershipId: true,
  merchantOrderNumber: true,
  gatewayOrderId: true,
  amount: true,
  currency: true,
  status: true,
  gatewayOrderStatus: true,
  gatewayPaymentState: true,
  actionCode: true,
  actionCodeDescription: true,
  formUrl: true,
  returnUrl: true,
  failUrl: true,
  planTitle: true,
  planSubtitle: true,
  planDescription: true,
  payerEmail: true,
  payerPhone: true,
  createdAt: true,
  updatedAt: true,
  redirectedAt: true,
  paidAt: true,
  failedAt: true,
  membershipIssuedAt: true,
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
} satisfies Prisma.PaymentOrderSelect;

type PaymentRecord = Prisma.PaymentOrderGetPayload<{
  select: typeof paymentSelect;
}>;

type AlfaRegisterResponse = {
  orderId?: string;
  formUrl?: string;
  errorCode?: string | number;
  errorMessage?: string;
};

type AlfaStatusResponse = {
  errorCode?: string | number;
  errorMessage?: string;
  orderNumber?: string;
  orderStatus?: number;
  actionCode?: string | number;
  actionCodeDescription?: string;
  paymentAmountInfo?: {
    paymentState?: string;
    approvedAmount?: number;
    depositedAmount?: number;
    refundedAmount?: number;
  };
};

type AdminPaymentsRange = {
  key: '30d';
  days: number;
  label: string;
};

type AdminLedgerCursor = {
  paidAt: string;
  id: string;
};

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly membershipsService: MembershipsService,
  ) {}

  async createPassPayment(userId: string, passPlanId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    const passPlan = await this.prisma.passPlan.findFirst({
      where: {
        id: passPlanId,
        isActive: true,
        group: {
          isActive: true,
          variant: {
            isActive: true,
            category: {
              isActive: true,
            },
          },
        },
      },
      select: {
        id: true,
        title: true,
        subtitle: true,
        description: true,
        price: true,
        currency: true,
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
    });

    if (!passPlan) {
      throw new NotFoundException('Pass plan not found');
    }

    const merchantOrderNumber = buildMerchantOrderNumber();
    const paymentId = createPaymentId();
    const returnUrl = this.buildResultUrl(paymentId, 'success');
    const failUrl = this.buildResultUrl(paymentId, 'fail');
    const expiresAt = new Date(
      Date.now() + this.resolveSessionTimeoutSecs() * 1000,
    );

    const created = await this.prisma.paymentOrder.create({
      data: {
        id: paymentId,
        userId,
        passPlanId: passPlan.id,
        merchantOrderNumber,
        amount: passPlan.price,
        currency: passPlan.currency,
        status: PaymentOrderStatus.CREATED,
        returnUrl,
        failUrl,
        planTitle: passPlan.title,
        planSubtitle: passPlan.subtitle,
        planDescription: passPlan.description,
        payerEmail: user.email,
        fiscalPayload: {
          customer: {
            email: user.email,
          },
          items: [],
        },
      },
      select: paymentSelect,
    });

    let registerResponse: AlfaRegisterResponse;

    try {
      registerResponse = await this.registerOrder(created);
    } catch (error) {
      await this.prisma.paymentOrder.update({
        where: { id: created.id },
        data: {
          status: PaymentOrderStatus.FAILED,
          failedAt: new Date(),
          actionCodeDescription:
            error instanceof Error
              ? error.message
              : 'Payment registration failed',
        },
      });

      throw error;
    }

    if (
      normalizeNumeric(registerResponse.errorCode) !== 0 ||
      !registerResponse.orderId ||
      !registerResponse.formUrl
    ) {
      await this.prisma.paymentOrder.update({
        where: { id: created.id },
        data: {
          status: PaymentOrderStatus.FAILED,
          failedAt: new Date(),
          actionCode: normalizeNullableNumber(registerResponse.errorCode),
          actionCodeDescription:
            registerResponse.errorMessage ?? 'Payment registration failed',
        },
      });

      throw new BadGatewayException(
        mapGatewayRegistrationError(
          registerResponse.errorCode,
          registerResponse.errorMessage,
        ),
      );
    }

    await this.prisma.paymentOrder.update({
      where: { id: created.id },
      data: {
        gatewayOrderId: registerResponse.orderId,
        formUrl: registerResponse.formUrl,
        status: PaymentOrderStatus.FORM_REGISTERED,
      },
    });

    return {
      paymentId: created.id,
      formUrl: registerResponse.formUrl,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async getPaymentStatus(userId: string, paymentId: string) {
    const payment = await this.getPaymentForUser(userId, paymentId);

    return this.mapPaymentStatus(payment);
  }

  async confirmPayment(userId: string, paymentId: string) {
    const payment = await this.getPaymentForUser(userId, paymentId);

    if (!payment.gatewayOrderId) {
      return this.mapPaymentStatus(payment);
    }

    const statusResponse = await this.fetchGatewayStatus(
      payment.gatewayOrderId,
    );
    const nextState = resolvePaymentState(statusResponse, payment);

    const synced = await this.prisma.paymentOrder.update({
      where: { id: payment.id },
      data: {
        status: nextState.status,
        gatewayOrderStatus: nextState.gatewayOrderStatus,
        gatewayPaymentState: nextState.gatewayPaymentState,
        actionCode: nextState.actionCode,
        actionCodeDescription: nextState.actionCodeDescription,
        redirectedAt: payment.redirectedAt ?? new Date(),
        paidAt: nextState.paidAt ?? payment.paidAt,
        failedAt: nextState.failedAt ?? payment.failedAt,
      },
      select: paymentSelect,
    });

    let finalPayment = synced;

    if (shouldIssueMembership(synced)) {
      const membership =
        await this.membershipsService.issueMembershipFromPayment({
          userId: synced.userId,
          passPlanId: synced.passPlanId,
          paidAt: synced.paidAt ?? new Date(),
          title: synced.planTitle,
          subtitle: synced.planSubtitle,
          description: synced.planDescription,
        });

      finalPayment = await this.prisma.paymentOrder.update({
        where: { id: synced.id },
        data: {
          membershipId: membership.id,
          membershipIssuedAt: new Date(),
        },
        select: paymentSelect,
      });

      await this.attachQrSnapshotSafely(membership.id, finalPayment.id);
    } else if (
      synced.status === PaymentOrderStatus.PAID &&
      synced.membershipId
    ) {
      await this.attachQrSnapshotSafely(synced.membershipId, synced.id);
    }

    return this.mapPaymentStatus(finalPayment);
  }

  async getAdminPaymentsOverview(rangeKey?: string) {
    const range = resolveAdminPaymentsRange(rangeKey);
    const boundaries = getAdminPaymentsBoundaries(range.days);

    const [paidPayments, createdOrdersCount, previousCreatedOrdersCount] =
      await Promise.all([
      this.prisma.paymentOrder.findMany({
        where: {
          status: PaymentOrderStatus.PAID,
          paidAt: {
            gte: boundaries.previousStart,
            lt: boundaries.currentEndExclusive,
          },
        },
        select: paymentSelect,
      }),
      this.prisma.paymentOrder.count({
        where: {
          createdAt: {
            gte: boundaries.currentStart,
            lt: boundaries.currentEndExclusive,
          },
        },
      }),
      this.prisma.paymentOrder.count({
        where: {
          createdAt: {
            gte: boundaries.previousStart,
            lt: boundaries.previousEndExclusive,
          },
        },
      }),
    ]);

    const currentPaid = paidPayments.filter(
      (payment) =>
        payment.paidAt &&
        payment.paidAt >= boundaries.currentStart &&
        payment.paidAt < boundaries.currentEndExclusive,
    );
    const previousPaid = paidPayments.filter(
      (payment) =>
        payment.paidAt &&
        payment.paidAt >= boundaries.previousStart &&
        payment.paidAt < boundaries.previousEndExclusive,
    );

    const currentMetrics = summarizePayments(currentPaid, createdOrdersCount);
    const previousMetrics = summarizePayments(
      previousPaid,
      previousCreatedOrdersCount,
    );
    const revenueSeries = buildDailySeries(
      currentPaid,
      boundaries.currentStart,
      range.days,
      'revenue',
    );
    const paymentsSeries = buildDailySeries(
      currentPaid,
      boundaries.currentStart,
      range.days,
      'count',
    );

    const currentWeekPayments = currentPaid.filter(
      (payment) =>
        payment.paidAt &&
        payment.paidAt >= boundaries.currentWeekStart &&
        payment.paidAt < boundaries.currentWeekEndExclusive,
    );
    const previousWeekPayments = paidPayments.filter(
      (payment) =>
        payment.paidAt &&
        payment.paidAt >= boundaries.previousWeekStart &&
        payment.paidAt < boundaries.previousWeekEndExclusive,
    );

    return {
      range: range.key,
      rangeLabel: range.label,
      generatedAt: new Date().toISOString(),
      totals: currentMetrics,
      comparisons: {
        grossRevenue: buildComparison(
          currentMetrics.grossRevenue,
          previousMetrics.grossRevenue,
        ),
        successfulPaymentsCount: buildComparison(
          currentMetrics.successfulPaymentsCount,
          previousMetrics.successfulPaymentsCount,
        ),
        averageCheck: buildComparison(
          currentMetrics.averageCheck,
          previousMetrics.averageCheck,
        ),
        paidConversionRate: buildComparison(
          currentMetrics.paidConversionRate,
          previousMetrics.paidConversionRate,
        ),
      },
      revenueSeries,
      paymentsSeries,
      weeklyComparison: {
        currentWeek: summarizeWeek(currentWeekPayments),
        previousWeek: summarizeWeek(previousWeekPayments),
      },
      topPlans: {
        byRevenue: buildTopPlans(currentPaid, 'revenue'),
        byCount: buildTopPlans(currentPaid, 'count'),
      },
    };
  }

  async getAdminPaymentsLedger(input: {
    range?: string;
    cursor?: string;
    limit?: number;
  }) {
    const range = resolveAdminPaymentsRange(input.range);
    const boundaries = getAdminPaymentsBoundaries(range.days);
    const limit = normalizeLedgerLimit(input.limit);
    const cursor = decodeLedgerCursor(input.cursor);
    const cursorWhere = cursor
      ? {
          OR: [
            {
              paidAt: {
                lt: new Date(cursor.paidAt),
              },
            },
            {
              paidAt: new Date(cursor.paidAt),
              id: {
                lt: cursor.id,
              },
            },
          ],
        }
      : {};

    const records = await this.prisma.paymentOrder.findMany({
      where: {
        status: PaymentOrderStatus.PAID,
        paidAt: {
          gte: boundaries.currentStart,
          lt: boundaries.currentEndExclusive,
        },
        ...cursorWhere,
      },
      orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: paymentSelect,
    });

    const items = records.slice(0, limit).map((payment) => ({
      paymentId: payment.id,
      merchantOrderNumber: payment.merchantOrderNumber,
      paidAt: payment.paidAt?.toISOString() ?? payment.createdAt.toISOString(),
      amount: kopecksToRubles(payment.amount),
      currency: payment.currency,
      status: payment.status,
      user: payment.user,
      plan: {
        id: payment.passPlan?.id ?? payment.passPlanId,
        title: payment.planTitle,
        subtitle: payment.planSubtitle,
        categoryTitle: payment.passPlan?.group.variant.category.title ?? null,
        variantTitle: payment.passPlan?.group.variant.title ?? null,
        groupTitle: payment.passPlan?.group.title ?? null,
      },
      membershipId: payment.membershipId,
      membershipIssuedAt: payment.membershipIssuedAt?.toISOString() ?? null,
    }));

    const lastItem = items.at(-1);

    return {
      range: range.key,
      items,
      nextCursor:
        records.length > limit && lastItem
          ? encodeLedgerCursor({
              paidAt: lastItem.paidAt,
              id: lastItem.paymentId,
            })
          : null,
    };
  }

  private async attachQrSnapshotSafely(
    membershipId: string,
    paymentId: string,
  ) {
    try {
      await this.membershipsService.attachQrSnapshotFromPayment(
        membershipId,
        paymentId,
      );
    } catch (error) {
      const details =
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : { error };

      this.logger.error(
        {
          paymentId,
          membershipId,
          ...details,
        },
        'Failed to attach membership QR snapshot after successful payment',
      );
    }
  }

  private async getPaymentForUser(userId: string, paymentId: string) {
    const payment = await this.prisma.paymentOrder.findUnique({
      where: { id: paymentId },
      select: paymentSelect,
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (payment.userId !== userId) {
      throw new ForbiddenException('Payment is unavailable');
    }

    return payment;
  }

  private async registerOrder(payment: PaymentRecord) {
    return this.callAlfa<AlfaRegisterResponse>('register.do', {
      orderNumber: payment.merchantOrderNumber,
      amount: toGatewayAmount(payment.amount, payment.currency),
      currency: ALFA_CURRENCY_CODE,
      returnUrl: payment.returnUrl,
      failUrl: payment.failUrl,
      pageView: 'MOBILE',
      language: ALFA_LANGUAGE,
      email: payment.payerEmail ?? undefined,
      jsonParams: JSON.stringify({
        paymentId: payment.id,
        userId: payment.userId,
        passPlanId: payment.passPlanId,
        email: payment.payerEmail ?? undefined,
      }),
      sessionTimeoutSecs: String(this.resolveSessionTimeoutSecs()),
      description: sanitizeDescription(payment.planTitle),
    });
  }

  private async fetchGatewayStatus(orderId: string) {
    return this.callAlfa<AlfaStatusResponse>('getOrderStatusExtended.do', {
      orderId,
      language: ALFA_LANGUAGE,
    });
  }

  private async callAlfa<T>(
    method: string,
    params: Record<string, string | undefined>,
  ) {
    const baseUrl = this.configService.get<string>('ALFA_GATEWAY_BASE_URL');
    const userName = this.configService.get<string>('ALFA_GATEWAY_USERNAME');
    const password = this.configService.get<string>('ALFA_GATEWAY_PASSWORD');

    if (!baseUrl || !userName || !password) {
      throw new BadGatewayException('Alfa payment gateway is not configured');
    }

    const formData = new URLSearchParams();
    formData.set('userName', userName);
    formData.set('password', password);

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        formData.set(key, value);
      }
    }

    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData,
    });

    if (!response.ok) {
      throw new BadGatewayException(
        `Alfa payment gateway request failed with status ${response.status}`,
      );
    }

    return (await response.json()) as T;
  }

  private resolveSessionTimeoutSecs() {
    const rawValue = this.configService.get<string>(
      'PAYMENT_SESSION_TIMEOUT_SECS',
    );
    const parsed = rawValue ? Number(rawValue) : NaN;

    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }

    return DEFAULT_SESSION_TIMEOUT_SECS;
  }

  private buildResultUrl(paymentId: string, result: 'success' | 'fail') {
    const configuredUrl =
      result === 'success'
        ? this.configService.get<string>('PAYMENT_RETURN_URL')
        : this.configService.get<string>('PAYMENT_FAIL_URL');

    const baseUrl =
      configuredUrl ??
      `${this.configService.get<string>('FRONTEND_ORIGIN') ?? 'http://localhost:3000'}/payments/result`;

    const url = new URL(baseUrl);
    url.searchParams.set('paymentId', paymentId);
    url.searchParams.set('result', result);

    return url.toString();
  }

  private mapPaymentStatus(payment: PaymentRecord) {
    const statusMeta = getPaymentStatusMeta(payment.status);

    return {
      paymentId: payment.id,
      status: payment.status,
      statusLabel: statusMeta.label,
      statusTone: statusMeta.tone,
      message: statusMeta.message,
      amount: kopecksToRubles(payment.amount),
      currency: payment.currency,
      planTitle: payment.planTitle,
      planSubtitle: payment.planSubtitle,
      planCategoryTitle: payment.passPlan?.group.variant.category.title ?? null,
      planVariantTitle: payment.passPlan?.group.variant.title ?? null,
      planGroupTitle: payment.passPlan?.group.title ?? null,
      createdAt: payment.createdAt.toISOString(),
      updatedAt: payment.updatedAt.toISOString(),
      paidAt: payment.paidAt?.toISOString() ?? null,
      failedAt: payment.failedAt?.toISOString() ?? null,
      formUrl: payment.formUrl,
      actionCode: payment.actionCode,
      actionCodeDescription: payment.actionCodeDescription,
      membershipId: payment.membershipId,
      membershipIssuedAt: payment.membershipIssuedAt?.toISOString() ?? null,
      canRetry:
        payment.status === PaymentOrderStatus.FAILED ||
        payment.status === PaymentOrderStatus.EXPIRED,
      isFinal:
        payment.status === PaymentOrderStatus.PAID ||
        payment.status === PaymentOrderStatus.FAILED ||
        payment.status === PaymentOrderStatus.EXPIRED ||
        payment.status === PaymentOrderStatus.CANCELLED,
    };
  }
}

function resolveAdminPaymentsRange(rangeKey?: string): AdminPaymentsRange {
  if (rangeKey && rangeKey !== '30d') {
    throw new NotFoundException('Payment analytics range is not supported');
  }

  return {
    key: '30d',
    days: 30,
    label: 'Последние 30 дней',
  };
}

function getAdminPaymentsBoundaries(days: number) {
  const todayStart = startOfDay(new Date());
  const currentStart = addDays(todayStart, -(days - 1));
  const currentEndExclusive = addDays(todayStart, 1);
  const previousStart = addDays(currentStart, -days);
  const previousEndExclusive = currentStart;
  const currentWeekStart = startOfWeek(todayStart);
  const currentWeekEndExclusive = addDays(currentWeekStart, 7);
  const previousWeekStart = addDays(currentWeekStart, -7);
  const previousWeekEndExclusive = currentWeekStart;

  return {
    currentStart,
    currentEndExclusive,
    previousStart,
    previousEndExclusive,
    currentWeekStart,
    currentWeekEndExclusive,
    previousWeekStart,
    previousWeekEndExclusive,
  };
}

function startOfDay(value: Date) {
  return new Date(
    value.getFullYear(),
    value.getMonth(),
    value.getDate(),
    0,
    0,
    0,
    0,
  );
}

function startOfWeek(value: Date) {
  const day = value.getDay();
  const diff = day === 0 ? -6 : 1 - day;

  return startOfDay(addDays(value, diff));
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function summarizePayments(payments: PaymentRecord[], createdOrdersCount: number) {
  const grossRevenueKopecks = payments.reduce(
    (sum, payment) => sum + payment.amount,
    0,
  );
  const successfulPaymentsCount = payments.length;
  const averageCheckKopecks =
    successfulPaymentsCount > 0
      ? Math.round(grossRevenueKopecks / successfulPaymentsCount)
      : 0;

  return {
    grossRevenue: kopecksToRubles(grossRevenueKopecks),
    successfulPaymentsCount,
    averageCheck: kopecksToRubles(averageCheckKopecks),
    createdOrdersCount,
    paidConversionRate:
      createdOrdersCount > 0
        ? roundMetric((successfulPaymentsCount / createdOrdersCount) * 100)
        : 0,
  };
}

function buildComparison(current: number, previous: number) {
  const delta = roundMetric(current - previous);
  const deltaPercent =
    previous !== 0 ? roundMetric((delta / previous) * 100) : null;

  return {
    current: roundMetric(current),
    previous: roundMetric(previous),
    delta,
    deltaPercent,
  };
}

function buildDailySeries(
  payments: PaymentRecord[],
  start: Date,
  days: number,
  mode: 'revenue' | 'count',
) {
  const buckets = new Map<string, number>();

  for (let index = 0; index < days; index += 1) {
    const date = addDays(start, index);
    buckets.set(toIsoDate(date), 0);
  }

  for (const payment of payments) {
    if (!payment.paidAt) {
      continue;
    }

    const key = toIsoDate(payment.paidAt);
    const current = buckets.get(key);

    if (current === undefined) {
      continue;
    }

    buckets.set(
      key,
      current + (mode === 'revenue' ? kopecksToRubles(payment.amount) : 1),
    );
  }

  return Array.from(buckets.entries()).map(([date, value]) => ({
    date,
    value: roundMetric(value),
  }));
}

function summarizeWeek(payments: PaymentRecord[]) {
  const grossRevenueKopecks = payments.reduce(
    (sum, payment) => sum + payment.amount,
    0,
  );

  return {
    grossRevenue: kopecksToRubles(grossRevenueKopecks),
    successfulPaymentsCount: payments.length,
  };
}

function buildTopPlans(
  payments: PaymentRecord[],
  mode: 'revenue' | 'count',
) {
  const buckets = new Map<
    string,
    {
      planId: string;
      title: string;
      subtitle: string | null;
      categoryTitle: string | null;
      value: number;
    }
  >();

  for (const payment of payments) {
    const planId = payment.passPlan?.id ?? payment.passPlanId;
    const existing = buckets.get(planId);
    const nextValue =
      (existing?.value ?? 0) + (mode === 'revenue' ? payment.amount : 1);

    buckets.set(planId, {
      planId,
      title: payment.planTitle,
      subtitle: payment.planSubtitle,
      categoryTitle: payment.passPlan?.group.variant.category.title ?? null,
      value: nextValue,
    });
  }

  return Array.from(buckets.values())
    .sort((left, right) => right.value - left.value)
    .slice(0, 5)
    .map((entry) => ({
      ...entry,
      value:
        mode === 'revenue'
          ? kopecksToRubles(entry.value)
          : roundMetric(entry.value),
    }));
}

function normalizeLedgerLimit(limit?: number) {
  if (!limit || Number.isNaN(limit)) {
    return 20;
  }

  return Math.max(1, Math.min(100, Math.trunc(limit)));
}

function encodeLedgerCursor(cursor: AdminLedgerCursor) {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeLedgerCursor(cursor?: string) {
  if (!cursor) {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as AdminLedgerCursor;

    if (!parsed.paidAt || !parsed.id) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function roundMetric(value: number) {
  return Math.round(value * 100) / 100;
}

function createPaymentId() {
  return `pay_${randomUUID()}`;
}

function buildMerchantOrderNumber() {
  return `fit-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function sanitizeDescription(value: string) {
  return value.replace(/[%+\r\n]/g, ' ').slice(0, 99);
}

function normalizeNumeric(value: string | number | undefined) {
  return Number(value ?? 0);
}

function normalizeNullableNumber(value: string | number | undefined) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) ? parsed : null;
}

function resolvePaymentState(
  statusResponse: AlfaStatusResponse,
  payment: PaymentRecord,
) {
  const errorCode = normalizeNumeric(statusResponse.errorCode);
  const orderStatus =
    statusResponse.orderStatus ?? payment.gatewayOrderStatus ?? null;
  const paymentAmounts = normalizeGatewayAmounts(statusResponse.paymentAmountInfo);
  const paymentState = paymentAmounts.paymentState;
  const actionCode = normalizeNullableNumber(statusResponse.actionCode);
  const actionCodeDescription =
    statusResponse.actionCodeDescription ??
    statusResponse.errorMessage ??
    payment.actionCodeDescription ??
    null;

  if (
    errorCode === 0 &&
    (orderStatus === 2 ||
      paymentState === 'DEPOSITED' ||
      (paymentAmounts.depositedAmountKopecks !== null &&
        paymentAmounts.depositedAmountKopecks >= payment.amount))
  ) {
    return {
      status: PaymentOrderStatus.PAID,
      gatewayOrderStatus: orderStatus,
      gatewayPaymentState: paymentState,
      actionCode,
      actionCodeDescription,
      paidAt: new Date(),
      failedAt: null,
    };
  }

  if (isExpiredStatus(statusResponse)) {
    return {
      status: PaymentOrderStatus.EXPIRED,
      gatewayOrderStatus: orderStatus,
      gatewayPaymentState: paymentState,
      actionCode,
      actionCodeDescription,
      paidAt: null,
      failedAt: new Date(),
    };
  }

  if (orderStatus === 6 || errorCode === 2) {
    return {
      status: PaymentOrderStatus.FAILED,
      gatewayOrderStatus: orderStatus,
      gatewayPaymentState: paymentState,
      actionCode,
      actionCodeDescription,
      paidAt: null,
      failedAt: new Date(),
    };
  }

  if (orderStatus === 3 || orderStatus === 4) {
    return {
      status: PaymentOrderStatus.CANCELLED,
      gatewayOrderStatus: orderStatus,
      gatewayPaymentState: paymentState,
      actionCode,
      actionCodeDescription,
      paidAt: null,
      failedAt: new Date(),
    };
  }

  return {
    status:
      payment.status === PaymentOrderStatus.CREATED ||
      payment.status === PaymentOrderStatus.FORM_REGISTERED
        ? PaymentOrderStatus.REDIRECTED
        : payment.status,
    gatewayOrderStatus: orderStatus,
    gatewayPaymentState: paymentState,
    actionCode,
    actionCodeDescription,
    paidAt: payment.paidAt,
    failedAt: payment.failedAt,
  };
}

function normalizeGatewayAmounts(
  paymentAmountInfo: AlfaStatusResponse['paymentAmountInfo'] | undefined,
) {
  return {
    paymentState: paymentAmountInfo?.paymentState ?? null,
    approvedAmountKopecks: normalizeNullableNumber(
      paymentAmountInfo?.approvedAmount,
    ),
    depositedAmountKopecks: normalizeNullableNumber(
      paymentAmountInfo?.depositedAmount,
    ),
    refundedAmountKopecks: normalizeNullableNumber(
      paymentAmountInfo?.refundedAmount,
    ),
  };
}

function isExpiredStatus(statusResponse: AlfaStatusResponse) {
  return statusResponse.actionCode === -2007 ||
    statusResponse.actionCode === '-2007' ||
    statusResponse.actionCodeDescription?.toLowerCase().includes('истек') ||
    statusResponse.actionCodeDescription?.toLowerCase().includes('expired')
    ? true
    : false;
}

function shouldIssueMembership(payment: PaymentRecord) {
  return (
    payment.status === PaymentOrderStatus.PAID && !payment.membershipIssuedAt
  );
}

function getPaymentStatusMeta(status: PaymentOrderStatus) {
  switch (status) {
    case PaymentOrderStatus.PAID:
      return {
        label: 'Оплата прошла',
        tone: 'success',
        message: 'Абонемент активирован и уже доступен в вашем кабинете.',
      };
    case PaymentOrderStatus.EXPIRED:
      return {
        label: 'Время оплаты истекло',
        tone: 'warning',
        message:
          'Сессия оплаты истекла. Создайте новый платёж и повторите попытку.',
      };
    case PaymentOrderStatus.FAILED:
      return {
        label: 'Оплата не прошла',
        tone: 'danger',
        message:
          'Банк не подтвердил оплату. Проверьте данные карты и повторите попытку.',
      };
    case PaymentOrderStatus.CANCELLED:
      return {
        label: 'Платёж отменён',
        tone: 'muted',
        message: 'Платёж был отменён и абонемент не был активирован.',
      };
    case PaymentOrderStatus.REDIRECTED:
      return {
        label: 'Ожидаем результат',
        tone: 'warning',
        message: 'Платёж обрабатывается. Обновляем данные у платёжного шлюза.',
      };
    case PaymentOrderStatus.FORM_REGISTERED:
    case PaymentOrderStatus.CREATED:
      return {
        label: 'Платёж создан',
        tone: 'warning',
        message: 'Переходим к оплате через банковский шлюз.',
      };
  }
}

function mapGatewayRegistrationError(
  errorCode: string | number | undefined,
  errorMessage: string | undefined,
) {
  const normalizedMessage = (errorMessage ?? '').toLowerCase();

  if (
    normalizeNumeric(errorCode) === 5 &&
    (normalizedMessage.includes('access denied') ||
      normalizedMessage.includes('доступ запрещ'))
  ) {
    return 'Платёжный шлюз отклонил доступ. Проверьте API-логин, пароль и обязательно смените временный пароль Alfa.';
  }

  return errorMessage ?? 'Payment registration failed';
}
