import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PaymentOrderStatus,
  Prisma,
} from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { kopecksToRubles } from '../common/money/money';
import { MembershipsService } from '../memberships/memberships.service';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_PAYMENT_TTL_MINUTES = 60;
const DEFAULT_TBANK_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_TBANK_API_URL = 'https://securepay.tinkoff.ru/v2';
const DEFAULT_RECEIPT_TAXATION = 'osn';
const DEFAULT_RECEIPT_TAX = 'none';
const DEFAULT_TBANK_PAY_TYPE = 'O';
const DEFAULT_TBANK_LANGUAGE = 'ru';
const DEFAULT_RECEIPT_PAYMENT_METHOD = 'full_payment';
const DEFAULT_RECEIPT_PAYMENT_OBJECT = 'service';

const paymentSelect = {
  id: true,
  userId: true,
  passPlanId: true,
  membershipId: true,
  gatewayProvider: true,
  merchantOrderNumber: true,
  gatewayOrderId: true,
  gatewayPaymentId: true,
  amount: true,
  currency: true,
  status: true,
  gatewayOrderStatus: true,
  gatewayPaymentState: true,
  gatewayStatus: true,
  gatewayErrorCode: true,
  gatewayMessage: true,
  gatewayDetails: true,
  actionCode: true,
  actionCodeDescription: true,
  formUrl: true,
  paymentUrl: true,
  returnUrl: true,
  failUrl: true,
  planTitle: true,
  planSubtitle: true,
  planDescription: true,
  payerEmail: true,
  payerPhone: true,
  fiscalPayload: true,
  receiptPayload: true,
  refundedAmount: true,
  notificationTokenValid: true,
  lastNotificationAt: true,
  createdAt: true,
  updatedAt: true,
  redirectedAt: true,
  paidAt: true,
  failedAt: true,
  refundedAt: true,
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
      billingType: true,
      durationValue: true,
      durationUnit: true,
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

const paymentDetailSelect = {
  ...paymentSelect,
  events: {
    orderBy: {
      createdAt: 'desc',
    },
    take: 50,
  },
} satisfies Prisma.PaymentOrderSelect;

type PaymentRecord = Prisma.PaymentOrderGetPayload<{
  select: typeof paymentSelect;
}>;

type PaymentDetailRecord = Prisma.PaymentOrderGetPayload<{
  select: typeof paymentDetailSelect;
}>;

type AdminPaymentsRange = {
  key: '30d';
  days: number;
  label: string;
};

type AdminLedgerCursor = {
  createdAt: string;
  id: string;
};

type TBankInitResponse = {
  Success?: boolean;
  ErrorCode?: string;
  Message?: string;
  Details?: string;
  Status?: string;
  PaymentId?: string | number;
  PaymentURL?: string;
};

type TBankGetStateResponse = {
  Success?: boolean;
  ErrorCode?: string;
  Message?: string;
  Details?: string;
  Status?: string;
  PaymentId?: string | number;
  OrderId?: string;
  Amount?: number;
};

type TBankCancelResponse = {
  Success?: boolean;
  ErrorCode?: string;
  Message?: string;
  Details?: string;
  Status?: string;
  PaymentId?: string | number;
  OriginalAmount?: number;
  NewAmount?: number;
};

type TBankNotification = Record<string, unknown> & {
  Token?: string;
  Status?: string;
  PaymentId?: string | number;
  ErrorCode?: string | number;
  Message?: string;
  Details?: string;
  Success?: boolean;
  Amount?: number;
  OrderId?: string;
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
        name: true,
        phone: true,
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
        billingType: true,
        durationValue: true,
        durationUnit: true,
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

    if (passPlan.currency !== 'RUB') {
      throw new BadRequestException('Only RUB payments are supported');
    }

    const merchantOrderNumber = buildMerchantOrderNumber();
    const paymentId = createPaymentId();
    const returnUrl = this.buildResultUrl(paymentId, 'success');
    const failUrl = this.buildResultUrl(paymentId, 'fail');
    const expiresAt = addMinutes(new Date(), this.resolvePaymentTtlMinutes());
    this.validateTBankConfiguration();

    const receiptPayload = this.buildReceiptPayload({
      user,
      passPlan,
    });

    const created = await this.prisma.paymentOrder.create({
      data: {
        id: paymentId,
        userId,
        passPlanId: passPlan.id,
        gatewayProvider: 'TBANK',
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
        payerPhone: user.phone,
        receiptPayload,
        fiscalPayload: receiptPayload,
      },
      select: paymentSelect,
    });

    await this.appendEvent(created.id, 'INIT_REQUEST', {
      payload: {
        paymentId: created.id,
        merchantOrderNumber: created.merchantOrderNumber,
        amount: created.amount,
      },
      success: true,
    });

    let initResponse: TBankInitResponse;

    try {
      initResponse = await this.initGatewayPayment(created, expiresAt);
      this.logger.warn({ initResponse }, 'TBank Init response');
    } catch (error) {
      await this.prisma.paymentOrder.update({
        where: { id: created.id },
        data: {
          status: PaymentOrderStatus.FAILED,
          failedAt: new Date(),
          gatewayErrorCode: 'NETWORK_ERROR',
          gatewayMessage:
            error instanceof Error ? error.message : 'Payment initialization failed',
          actionCodeDescription:
            error instanceof Error ? error.message : 'Payment initialization failed',
        },
      });

      await this.appendEvent(created.id, 'INIT_RESPONSE', {
        success: false,
        errorCode: 'NETWORK_ERROR',
        message:
          error instanceof Error ? error.message : 'Payment initialization failed',
      });

      throw error;
    }

    await this.appendEvent(created.id, 'INIT_RESPONSE', {
      gatewayStatus: initResponse.Status,
      success: Boolean(initResponse.Success),
      errorCode: toOptionalString(initResponse.ErrorCode),
      message: initResponse.Message ?? initResponse.Details ?? null,
      payload: initResponse,
    });

    if (
      !initResponse.Success ||
      !initResponse.PaymentId ||
      !initResponse.PaymentURL
    ) {
      await this.prisma.paymentOrder.update({
        where: { id: created.id },
        data: {
          status: PaymentOrderStatus.FAILED,
          failedAt: new Date(),
          gatewayStatus: initResponse.Status ?? null,
          gatewayErrorCode: toOptionalString(initResponse.ErrorCode),
          gatewayMessage: initResponse.Message ?? null,
          gatewayDetails: initResponse.Details ?? null,
          actionCodeDescription:
            initResponse.Message ??
            initResponse.Details ??
            'Payment initialization failed',
        },
      });

      throw new BadGatewayException(
        initResponse.Message ??
          initResponse.Details ??
          'Payment initialization failed',
      );
    }

    await this.prisma.paymentOrder.update({
      where: { id: created.id },
      data: {
        gatewayPaymentId: String(initResponse.PaymentId),
        gatewayStatus: initResponse.Status ?? 'NEW',
        paymentUrl: initResponse.PaymentURL,
        formUrl: initResponse.PaymentURL,
        gatewayErrorCode: toOptionalString(initResponse.ErrorCode),
        gatewayMessage: initResponse.Message ?? null,
        gatewayDetails: initResponse.Details ?? null,
        status: PaymentOrderStatus.REDIRECT_READY,
      },
    });

    return {
      paymentId: created.id,
      formUrl: initResponse.PaymentURL,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async getPaymentStatus(userId: string, paymentId: string) {
    const payment = await this.getPaymentForUser(userId, paymentId);
    return this.mapPaymentStatus(payment);
  }

  async confirmPayment(userId: string, paymentId: string) {
    const payment = await this.getPaymentForUser(userId, paymentId);
    return this.syncPaymentStatus(payment);
  }

  async handleTBankWebhook(notification: TBankNotification) {
    const gatewayPaymentId = notification.PaymentId
      ? String(notification.PaymentId)
      : null;
    const payment = gatewayPaymentId
      ? await this.prisma.paymentOrder.findFirst({
          where: {
            gatewayProvider: 'TBANK',
            gatewayPaymentId,
          },
          select: paymentSelect,
        })
      : null;

    const isTokenValid = this.isValidTBankToken(notification);

    if (!payment) {
      this.logger.warn(
        { gatewayPaymentId, orderId: notification.OrderId, isTokenValid },
        'T-Bank webhook received for unknown payment',
      );
      return 'OK';
    }

    await this.appendEvent(
      payment.id,
      isTokenValid
        ? 'WEBHOOK_RECEIVED'
        : 'WEBHOOK_REJECTED',
      {
        gatewayStatus: toOptionalString(notification.Status),
        success: Boolean(notification.Success),
        errorCode: toOptionalString(notification.ErrorCode),
        message:
          toOptionalString(notification.Message) ??
          toOptionalString(notification.Details),
        payload: notification,
      },
    );

    await this.prisma.paymentOrder.update({
      where: { id: payment.id },
      data: {
        lastNotificationAt: new Date(),
        notificationTokenValid: isTokenValid,
      },
    });

    if (!isTokenValid) {
      return 'OK';
    }

    const synced = await this.applyGatewaySnapshot(payment, notification, {
      markRedirected: true,
    });
    await this.issueMembershipIfNeeded(synced);

    return 'OK';
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
      revenueSeries: buildDailySeries(
        currentPaid,
        boundaries.currentStart,
        range.days,
        'revenue',
      ),
      paymentsSeries: buildDailySeries(
        currentPaid,
        boundaries.currentStart,
        range.days,
        'count',
      ),
      weeklyComparison: {
        currentWeek: summarizeWeek(
          currentPaid.filter(
            (payment) =>
              payment.paidAt &&
              payment.paidAt >= boundaries.currentWeekStart &&
              payment.paidAt < boundaries.currentWeekEndExclusive,
          ),
        ),
        previousWeek: summarizeWeek(
          paidPayments.filter(
            (payment) =>
              payment.paidAt &&
              payment.paidAt >= boundaries.previousWeekStart &&
              payment.paidAt < boundaries.previousWeekEndExclusive,
          ),
        ),
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
              createdAt: {
                lt: new Date(cursor.createdAt),
              },
            },
            {
              createdAt: new Date(cursor.createdAt),
              id: {
                lt: cursor.id,
              },
            },
          ],
        }
      : {};

    const records = await this.prisma.paymentOrder.findMany({
      where: {
        createdAt: {
          gte: boundaries.currentStart,
          lt: boundaries.currentEndExclusive,
        },
        status: {
          not: PaymentOrderStatus.CREATED,
        },
        ...cursorWhere,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: paymentSelect,
    });

    const items = records.slice(0, limit).map((payment) => ({
      paymentId: payment.id,
      merchantOrderNumber: payment.merchantOrderNumber,
      paidAt: resolveLedgerTimestamp(payment),
      amount: kopecksToRubles(payment.amount),
      currency: payment.currency,
      status: payment.status,
      gatewayProvider: payment.gatewayProvider,
      gatewayPaymentId: payment.gatewayPaymentId,
      gatewayStatus: payment.gatewayStatus,
      refundedAmount: kopecksToRubles(payment.refundedAmount),
      canRefund: canRefund(payment),
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
              createdAt: records[limit - 1].createdAt.toISOString(),
              id: lastItem.paymentId,
            })
          : null,
    };
  }

  async getAdminPaymentDetails(paymentId: string) {
    const payment = await this.prisma.paymentOrder.findUnique({
      where: { id: paymentId },
      select: paymentDetailSelect,
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    return {
      ...this.mapPaymentStatus(payment),
      gatewayProvider: payment.gatewayProvider,
      gatewayPaymentId: payment.gatewayPaymentId,
      gatewayOrderId: payment.gatewayOrderId,
      gatewayStatus: payment.gatewayStatus,
      gatewayErrorCode: payment.gatewayErrorCode,
      gatewayMessage: payment.gatewayMessage,
      gatewayDetails: payment.gatewayDetails,
      refundedAmount: kopecksToRubles(payment.refundedAmount),
      refundedAt: payment.refundedAt?.toISOString() ?? null,
      notificationTokenValid: payment.notificationTokenValid,
      lastNotificationAt: payment.lastNotificationAt?.toISOString() ?? null,
      receiptPayload: payment.receiptPayload,
      user: payment.user,
      plan: {
        id: payment.passPlan?.id ?? payment.passPlanId,
        title: payment.planTitle,
        subtitle: payment.planSubtitle,
        categoryTitle: payment.passPlan?.group.variant.category.title ?? null,
        variantTitle: payment.passPlan?.group.variant.title ?? null,
        groupTitle: payment.passPlan?.group.title ?? null,
      },
      events: payment.events.map((event) => ({
        id: event.id,
        type: event.type,
        gatewayStatus: event.gatewayStatus,
        success: event.success,
        errorCode: event.errorCode,
        message: event.message,
        payload: event.payload,
        createdAt: event.createdAt.toISOString(),
      })),
      canRefund: canRefund(payment),
    };
  }

  async refundAdminPayment(paymentId: string) {
    const payment = await this.prisma.paymentOrder.findUnique({
      where: { id: paymentId },
      select: paymentSelect,
    });

    if (!payment) {
      throw new NotFoundException('Payment not found');
    }

    if (payment.gatewayProvider !== 'TBANK') {
      throw new BadRequestException('Legacy gateway refunds are not supported');
    }

    if (payment.status === PaymentOrderStatus.REFUNDED) {
      if (payment.membershipId) {
        await this.membershipsService.revokeMembershipAfterRefund(
          payment.membershipId,
        );
      }

      return this.getAdminPaymentDetails(payment.id);
    }

    if (!canRefund(payment)) {
      throw new BadRequestException('Payment cannot be refunded');
    }

    if (!payment.gatewayPaymentId) {
      throw new BadRequestException('Gateway payment id is missing');
    }

    await this.appendEvent(payment.id, 'REFUND_REQUEST', {
      success: true,
      payload: {
        gatewayPaymentId: payment.gatewayPaymentId,
        amount: payment.amount,
      },
    });

    const response = await this.cancelGatewayPayment(payment);

    await this.appendEvent(payment.id, 'REFUND_RESPONSE', {
      gatewayStatus: response.Status,
      success: Boolean(response.Success),
      errorCode: toOptionalString(response.ErrorCode),
      message: response.Message ?? response.Details ?? null,
      payload: response,
    });

    if (!response.Success) {
      await this.prisma.paymentOrder.update({
        where: { id: payment.id },
        data: {
          gatewayStatus: response.Status ?? payment.gatewayStatus,
          gatewayErrorCode: toOptionalString(response.ErrorCode),
          gatewayMessage: response.Message ?? null,
          gatewayDetails: response.Details ?? null,
        },
      });

      throw new BadGatewayException(
        response.Message ?? response.Details ?? 'Refund request failed',
      );
    }

    const updated = await this.applyGatewaySnapshot(payment, response, {
      markRedirected: false,
      refundedAmount: payment.amount,
    });

    const finalPayment = await this.issueMembershipIfNeeded(updated);

    return this.getAdminPaymentDetails(finalPayment.id);
  }

  private async syncPaymentStatus(payment: PaymentRecord) {
    if (payment.gatewayProvider !== 'TBANK') {
      return this.mapPaymentStatus(payment);
    }

    if (!payment.gatewayPaymentId) {
      return this.mapPaymentStatus(payment);
    }

    await this.appendEvent(payment.id, 'GET_STATE_REQUEST', {
      success: true,
      payload: {
        gatewayPaymentId: payment.gatewayPaymentId,
      },
    });

    const response = await this.getGatewayPaymentState(payment.gatewayPaymentId);

    await this.appendEvent(payment.id, 'GET_STATE_RESPONSE', {
      gatewayStatus: response.Status,
      success: Boolean(response.Success),
      errorCode: toOptionalString(response.ErrorCode),
      message: response.Message ?? response.Details ?? null,
      payload: response,
    });

    const synced = await this.applyGatewaySnapshot(payment, response, {
      markRedirected: true,
    });
    const finalPayment = await this.issueMembershipIfNeeded(synced);

    return this.mapPaymentStatus(finalPayment);
  }

  private async issueMembershipIfNeeded(payment: PaymentRecord) {
    if (
      payment.status === PaymentOrderStatus.REFUNDED &&
      payment.membershipId
    ) {
      await this.membershipsService.revokeMembershipAfterRefund(
        payment.membershipId,
      );
      return payment;
    }

    if (!shouldIssueMembership(payment)) {
      if (payment.status === PaymentOrderStatus.PAID && payment.membershipId) {
        await this.attachQrSnapshotSafely(payment.membershipId, payment.id);
      }

      return payment;
    }

    const membership = await this.membershipsService.issueMembershipFromPayment({
      userId: payment.userId,
      passPlanId: payment.passPlanId,
      paidAt: payment.paidAt ?? new Date(),
      title: payment.planTitle,
      subtitle: payment.planSubtitle,
      description: payment.planDescription,
    });

    const updated = await this.prisma.paymentOrder.update({
      where: { id: payment.id },
      data: {
        membershipId: membership.id,
        membershipIssuedAt: new Date(),
      },
      select: paymentSelect,
    });

    await this.attachQrSnapshotSafely(membership.id, payment.id);

    return updated;
  }

  private async attachQrSnapshotSafely(membershipId: string, paymentId: string) {
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
        'Failed to attach membership QR snapshot after payment sync',
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

  private buildReceiptPayload(input: {
    user: { email: string; name?: string | null; phone?: string | null };
    passPlan: {
      title: string;
      price: number;
      description?: string | null;
    };
  }) {
    const receiptEmail =
      input.user.email ||
      this.configService.get<string>('TBANK_RECEIPT_EMAIL_FALLBACK') ||
      null;

    return {
      Email: receiptEmail,
      Phone: input.user.phone || undefined,
      Taxation:
        this.configService.get<string>('TBANK_RECEIPT_TAXATION') ??
        this.configService.get<string>('TBANK_TAXATION') ??
        DEFAULT_RECEIPT_TAXATION,
      Items: [
        {
          Name: sanitizeReceiptItemName(input.passPlan.title),
          Price: input.passPlan.price,
          Quantity: 1,
          Amount: input.passPlan.price,
          Tax:
            this.configService.get<string>('TBANK_RECEIPT_ITEM_TAX') ??
            DEFAULT_RECEIPT_TAX,
          PaymentMethod:
            this.configService.get<string>('TBANK_RECEIPT_PAYMENT_METHOD') ??
            DEFAULT_RECEIPT_PAYMENT_METHOD,
          PaymentObject:
            this.configService.get<string>('TBANK_RECEIPT_PAYMENT_OBJECT') ??
            DEFAULT_RECEIPT_PAYMENT_OBJECT,
        },
      ],
    };
  }

  private buildInitPayload(payment: PaymentRecord, expiresAt: Date) {
    const payload = {
      TerminalKey: this.getRequiredConfig('TBANK_TERMINAL_KEY'),
      Amount: payment.amount,
      OrderId: payment.merchantOrderNumber,
      Description: sanitizeDescription(payment.planTitle),
      PayType: this.resolveTBankPayType(),
      Language: this.resolveTBankLanguage(),
      NotificationURL: this.getRequiredConfig('TBANK_NOTIFICATION_URL'),
      // Keep redirect URLs that were already built with paymentId/result.
      SuccessURL: payment.returnUrl,
      FailURL: payment.failUrl,
      RedirectDueDate: formatTBankDateTime(expiresAt),
      DATA: {
        paymentId: payment.id,
        userId: payment.userId,
        passPlanId: payment.passPlanId,
        email: payment.payerEmail ?? undefined,
      },
      Receipt: payment.receiptPayload ?? undefined,
    };

    this.validateInitPayload(payload);

    return payload;
  }

  private async initGatewayPayment(payment: PaymentRecord, expiresAt: Date) {
    const payload = this.buildInitPayload(payment, expiresAt);
    return this.callTBank<TBankInitResponse>('Init', payload);
  }

  private async getGatewayPaymentState(gatewayPaymentId: string) {
    return this.callTBank<TBankGetStateResponse>('GetState', {
      TerminalKey: this.getRequiredConfig('TBANK_TERMINAL_KEY'),
      PaymentId: gatewayPaymentId,
    });
  }

  private async cancelGatewayPayment(payment: PaymentRecord) {
    return this.callTBank<TBankCancelResponse>('Cancel', {
      TerminalKey: this.getRequiredConfig('TBANK_TERMINAL_KEY'),
      PaymentId: payment.gatewayPaymentId,
      Amount: payment.amount,
      Receipt: payment.receiptPayload ?? undefined,
      ExternalRequestId: randomUUID(),
    });
  }

  private async callTBank<T>(
    method: string,
    payload: Record<string, unknown>,
  ) {
    const requestId = randomUUID();
    const endpoint = `${this.resolveTBankApiUrl()}/${method}`;
    const controller = new AbortController();
    const timeoutMs = this.resolveTBankRequestTimeoutMs();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const requestBody = {
      ...payload,
      Token: this.createTBankToken(payload),
    };

    this.logger.log(
      {
        requestId,
        method,
        endpoint,
        payload: sanitizePayloadForLogs(payload),
      },
      'T-Bank request',
    );

    let response: Response;

    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === 'AbortError' || controller.signal.aborted)
      ) {
        throw new BadGatewayException(
          `T-Bank gateway request timed out after ${timeoutMs}ms`,
        );
      }

      throw error;
    } finally {
      clearTimeout(timeoutId);
    }

    const parsed = await parseGatewayResponse(response);

    this.logger.log(
      {
        requestId,
        method,
        endpoint,
        httpStatus: response.status,
        response: sanitizePayloadForLogs(parsed),
      },
      'T-Bank response',
    );

    if (!response.ok) {
      throw new BadGatewayException(
        `T-Bank gateway request failed with status ${response.status}`,
      );
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new BadGatewayException('T-Bank gateway returned invalid JSON');
    }

    return parsed as T;
  }

  private resolveTBankApiUrl() {
    return (
      this.configService.get<string>('TBANK_API_URL') ?? DEFAULT_TBANK_API_URL
    ).replace(/\/$/, '');
  }

  private resolveTBankRequestTimeoutMs() {
    const rawValue = this.configService.get<string>('TBANK_REQUEST_TIMEOUT_MS');
    const parsed = rawValue ? Number(rawValue) : NaN;

    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.trunc(parsed);
    }

    return DEFAULT_TBANK_REQUEST_TIMEOUT_MS;
  }

  private resolveTBankPayType() {
    const payType =
      this.configService.get<string>('TBANK_PAY_TYPE') ?? DEFAULT_TBANK_PAY_TYPE;

    if (payType !== 'O' && payType !== 'T') {
      throw new BadGatewayException('TBANK_PAY_TYPE must be O or T');
    }

    return payType;
  }

  private resolveTBankLanguage() {
    const language =
      this.configService.get<string>('TBANK_LANGUAGE') ?? DEFAULT_TBANK_LANGUAGE;

    if (language !== 'ru' && language !== 'en') {
      throw new BadGatewayException('TBANK_LANGUAGE must be ru or en');
    }

    return language;
  }

  private createTBankToken(payload: Record<string, unknown>) {
    const password = this.getRequiredConfig('TBANK_PASSWORD');
    const scalarPairs = Object.entries({
      ...payload,
      Password: password,
    })
      .filter(([key, value]) =>
        key !== 'Token' &&
        value !== undefined &&
        value !== null &&
        !Array.isArray(value) &&
        typeof value !== 'object',
      )
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, value]) => String(value));

    return createHash('sha256')
      .update(scalarPairs.join(''), 'utf8')
      .digest('hex');
  }

  private isValidTBankToken(payload: TBankNotification) {
    const actualToken = typeof payload.Token === 'string' ? payload.Token : null;

    if (!actualToken) {
      return false;
    }

    const expectedToken = this.createTBankToken(payload);
    return expectedToken === actualToken;
  }

  private getRequiredConfig(key: string) {
    const value = this.configService.get<string>(key);

    if (!value) {
      throw new BadGatewayException(`${key} is not configured`);
    }

    return value;
  }

  private validateTBankConfiguration() {
    const terminalKey = this.getRequiredConfig('TBANK_TERMINAL_KEY');
    const password = this.getRequiredConfig('TBANK_PASSWORD');
    const notificationUrl = this.getRequiredConfig('TBANK_NOTIFICATION_URL');

    if (terminalKey.length > 20) {
      throw new BadGatewayException(
        'TBANK_TERMINAL_KEY length must be less than or equal to 20',
      );
    }

    if (!password.trim()) {
      throw new BadGatewayException('TBANK_PASSWORD must not be empty');
    }

    assertValidUrl(notificationUrl, 'TBANK_NOTIFICATION_URL');

    if (
      this.configService.get<string>('NODE_ENV') === 'production' &&
      /demo|test/i.test(terminalKey)
    ) {
      this.logger.warn(
        { terminalKeyPreview: `${terminalKey.slice(0, 8)}...` },
        'T-Bank demo/test terminal key is used in production environment',
      );
    }
  }

  private validateInitPayload(payload: Record<string, unknown>) {
    const terminalKey = asRequiredString(payload.TerminalKey, 'TerminalKey');
    if (terminalKey.length > 20) {
      throw new BadGatewayException('TerminalKey length must be <= 20');
    }

    const orderId = asRequiredString(payload.OrderId, 'OrderId');
    if (orderId.length > 36) {
      throw new BadGatewayException('OrderId length must be <= 36');
    }

    const amount = asRequiredPositiveInt(payload.Amount, 'Amount');
    if (String(amount).length > 10) {
      throw new BadGatewayException('Amount length must be <= 10');
    }

    const description = asRequiredString(payload.Description, 'Description');
    if (description.length > 140) {
      throw new BadGatewayException('Description length must be <= 140');
    }

    const payType = asRequiredString(payload.PayType, 'PayType');
    if (payType !== 'O' && payType !== 'T') {
      throw new BadGatewayException('PayType must be O or T');
    }

    const language = asRequiredString(payload.Language, 'Language');
    if (language !== 'ru' && language !== 'en') {
      throw new BadGatewayException('Language must be ru or en');
    }

    const notificationUrl = asRequiredString(
      payload.NotificationURL,
      'NotificationURL',
    );
    assertValidUrl(notificationUrl, 'NotificationURL');

    const successUrl = payload.SuccessURL;
    if (typeof successUrl === 'string' && successUrl.length > 0) {
      assertValidUrl(successUrl, 'SuccessURL');
    }

    const failUrl = payload.FailURL;
    if (typeof failUrl === 'string' && failUrl.length > 0) {
      assertValidUrl(failUrl, 'FailURL');
    }

    const redirectDueDate = asRequiredString(
      payload.RedirectDueDate,
      'RedirectDueDate',
    );
    if (!isValidTBankDateTime(redirectDueDate)) {
      throw new BadGatewayException(
        'RedirectDueDate must match YYYY-MM-DDTHH:mm:ss+HH:MM',
      );
    }

    this.validateDataPayload(payload.DATA);
    this.validateReceiptPayload(payload.Receipt, amount);
  }

  private validateDataPayload(data: unknown) {
    if (data === undefined || data === null) {
      return;
    }

    if (typeof data !== 'object' || Array.isArray(data)) {
      throw new BadGatewayException('DATA must be an object');
    }

    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length > 20) {
      throw new BadGatewayException('DATA must contain at most 20 entries');
    }

    for (const [key, value] of entries) {
      if (key.length > 20) {
        throw new BadGatewayException('DATA key length must be <= 20');
      }

      const scalarValue =
        value === undefined || value === null ? '' : String(value);
      if (scalarValue.length > 100) {
        throw new BadGatewayException('DATA value length must be <= 100');
      }
    }
  }

  private validateReceiptPayload(receipt: unknown, amount: number) {
    if (receipt === undefined || receipt === null) {
      return;
    }

    if (typeof receipt !== 'object' || Array.isArray(receipt)) {
      throw new BadGatewayException('Receipt must be an object');
    }

    const receiptRecord = receipt as Record<string, unknown>;
    const email = receiptRecord.Email;
    const phone = receiptRecord.Phone;
    if (
      (typeof email !== 'string' || email.length === 0) &&
      (typeof phone !== 'string' || phone.length === 0)
    ) {
      throw new BadGatewayException(
        'Receipt must contain Email or Phone for fiscalization',
      );
    }

    const taxation = receiptRecord.Taxation;
    if (typeof taxation !== 'string' || taxation.length === 0) {
      throw new BadGatewayException('Receipt.Taxation is required');
    }

    const items = receiptRecord.Items;
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadGatewayException('Receipt.Items must be a non-empty array');
    }

    if (items.length > 100) {
      throw new BadGatewayException('Receipt.Items must contain at most 100 rows');
    }

    const itemsAmount = items.reduce((sum, rawItem) => {
      if (typeof rawItem !== 'object' || !rawItem || Array.isArray(rawItem)) {
        throw new BadGatewayException('Receipt.Items must contain objects');
      }

      const item = rawItem as Record<string, unknown>;
      const itemName = asRequiredString(item.Name, 'Receipt.Items[].Name');
      if (itemName.length > 128) {
        throw new BadGatewayException(
          'Receipt.Items[].Name length must be <= 128',
        );
      }

      const itemAmount = asRequiredPositiveInt(item.Amount, 'Receipt.Items[].Amount');
      return sum + itemAmount;
    }, 0);

    if (itemsAmount !== amount) {
      throw new BadGatewayException(
        'Amount must equal sum of Receipt.Items[].Amount',
      );
    }
  }

  private resolvePaymentTtlMinutes() {
    const rawValue = this.configService.get<string>('TBANK_PAYMENT_TTL_MINUTES');
    const parsed = rawValue ? Number(rawValue) : NaN;

    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }

    return DEFAULT_PAYMENT_TTL_MINUTES;
  }

  private buildResultUrl(paymentId: string, result: 'success' | 'fail') {
    const configuredUrl =
      result === 'success'
        ? this.configService.get<string>('TBANK_SUCCESS_URL')
        : this.configService.get<string>('TBANK_FAIL_URL');

    const baseUrl =
      configuredUrl ??
      `${this.configService.get<string>('FRONTEND_ORIGIN') ?? 'http://localhost:3000'}/payments/result`;

    const url = new URL(baseUrl);
    url.searchParams.set('paymentId', paymentId);
    url.searchParams.set('result', result);

    return url.toString();
  }

  private async applyGatewaySnapshot(
    payment: PaymentRecord,
    gatewayResponse: Record<string, unknown>,
    options: {
      markRedirected: boolean;
      refundedAmount?: number;
    },
  ) {
    const nextState = resolvePaymentState(gatewayResponse, payment, options);

    const updated = await this.prisma.paymentOrder.update({
      where: { id: payment.id },
      data: {
        status: nextState.status,
        gatewayStatus: nextState.gatewayStatus,
        gatewayPaymentState: nextState.gatewayStatus,
        gatewayErrorCode: nextState.gatewayErrorCode,
        gatewayMessage: nextState.gatewayMessage,
        gatewayDetails: nextState.gatewayDetails,
        actionCodeDescription: nextState.gatewayMessage ?? nextState.gatewayDetails,
        formUrl: nextState.paymentUrl ?? payment.formUrl,
        paymentUrl: nextState.paymentUrl ?? payment.paymentUrl,
        redirectedAt:
          options.markRedirected && !payment.redirectedAt
            ? new Date()
            : payment.redirectedAt,
        paidAt: nextState.paidAt ?? payment.paidAt,
        failedAt: nextState.failedAt ?? payment.failedAt,
        refundedAt: nextState.refundedAt ?? payment.refundedAt,
        refundedAmount:
          nextState.refundedAmount ?? payment.refundedAmount ?? 0,
      },
      select: paymentSelect,
    });

    await this.appendEvent(updated.id, 'STATUS_SYNC', {
      gatewayStatus: updated.gatewayStatus,
      success: true,
      payload: {
        status: updated.status,
        refundedAmount: updated.refundedAmount,
      },
    });

    await this.syncMembershipStateAfterPaymentUpdate(updated);

    return updated;
  }

  private async syncMembershipStateAfterPaymentUpdate(payment: PaymentRecord) {
    if (
      payment.status === PaymentOrderStatus.REFUNDED &&
      payment.membershipId
    ) {
      await this.membershipsService.revokeMembershipAfterRefund(
        payment.membershipId,
      );
    }
  }

  private async appendEvent(
    paymentOrderId: string,
    type:
      | 'INIT_REQUEST'
      | 'INIT_RESPONSE'
      | 'GET_STATE_REQUEST'
      | 'GET_STATE_RESPONSE'
      | 'WEBHOOK_RECEIVED'
      | 'WEBHOOK_REJECTED'
      | 'REFUND_REQUEST'
      | 'REFUND_RESPONSE'
      | 'STATUS_SYNC',
    input: {
      gatewayStatus?: string | null;
      success?: boolean | null;
      errorCode?: string | null;
      message?: string | null;
      payload?: unknown;
    },
  ) {
    await this.prisma.paymentOrderEvent.create({
      data: {
        paymentOrderId,
        type,
        gatewayStatus: input.gatewayStatus ?? null,
        success: input.success ?? null,
        errorCode: input.errorCode ?? null,
        message: input.message ?? null,
        payload:
          input.payload === undefined
            ? Prisma.JsonNull
            : (input.payload as Prisma.InputJsonValue),
      },
    });
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
      formUrl: payment.paymentUrl ?? payment.formUrl,
      actionCode: payment.actionCode,
      actionCodeDescription:
        payment.actionCodeDescription ??
        payment.gatewayMessage ??
        payment.gatewayDetails,
      membershipId: payment.membershipId,
      membershipIssuedAt: payment.membershipIssuedAt?.toISOString() ?? null,
      gatewayStatus: payment.gatewayStatus,
      gatewayProvider: payment.gatewayProvider,
      gatewayPaymentId: payment.gatewayPaymentId,
      refundedAmount: kopecksToRubles(payment.refundedAmount),
      refundedAt: payment.refundedAt?.toISOString() ?? null,
      canRetry:
        payment.status === PaymentOrderStatus.FAILED ||
        payment.status === PaymentOrderStatus.EXPIRED,
      isFinal:
        payment.status === PaymentOrderStatus.PAID ||
        payment.status === PaymentOrderStatus.FAILED ||
        payment.status === PaymentOrderStatus.EXPIRED ||
        payment.status === PaymentOrderStatus.CANCELLED ||
        payment.status === PaymentOrderStatus.REFUNDED,
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

function asRequiredString(value: unknown, fieldName: string) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new BadGatewayException(`${fieldName} is required`);
  }

  return value;
}

function asRequiredPositiveInt(value: unknown, fieldName: string) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new BadGatewayException(`${fieldName} must be a positive integer`);
  }

  return value;
}

function assertValidUrl(value: string, fieldName: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new BadGatewayException(`${fieldName} must be a valid HTTP(S) URL`);
    }
  } catch {
    throw new BadGatewayException(`${fieldName} must be a valid URL`);
  }
}

function pad2(value: number) {
  return String(value).padStart(2, '0');
}

function formatTBankDateTime(date: Date) {
  const year = date.getFullYear();
  const month = pad2(date.getMonth() + 1);
  const day = pad2(date.getDate());
  const hours = pad2(date.getHours());
  const minutes = pad2(date.getMinutes());
  const seconds = pad2(date.getSeconds());

  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const offsetHours = pad2(Math.floor(Math.abs(offsetMinutes) / 60));
  const offsetMins = pad2(Math.abs(offsetMinutes) % 60);

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${sign}${offsetHours}:${offsetMins}`;
}

function isValidTBankDateTime(value: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(value);
}

async function parseGatewayResponse(response: {
  text?: () => Promise<string>;
  json?: () => Promise<unknown>;
}) {
  if (typeof response.text === 'function') {
    const rawText = await response.text();
    if (!rawText.trim()) {
      return null;
    }

    try {
      return JSON.parse(rawText) as unknown;
    } catch {
      return null;
    }
  }

  if (typeof response.json === 'function') {
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  return null;
}

function sanitizePayloadForLogs(payload: unknown): unknown {
  if (Array.isArray(payload)) {
    return payload.map((value) => sanitizePayloadForLogs(value));
  }

  if (!payload || typeof payload !== 'object') {
    if (typeof payload === 'string' && payload.length > 300) {
      return `${payload.slice(0, 300)}...`;
    }
    return payload;
  }

  const hiddenKeys = new Set([
    'Token',
    'Password',
    'CardData',
    'EncryptedPaymentData',
    'PAN',
    'CVV',
    'CAVV',
  ]);

  return Object.fromEntries(
    Object.entries(payload as Record<string, unknown>).map(([key, value]) => {
      if (hiddenKeys.has(key)) {
        return [key, '[REDACTED]'];
      }

      return [key, sanitizePayloadForLogs(value)];
    }),
  );
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

function addMinutes(value: Date, minutes: number) {
  return new Date(value.getTime() + minutes * 60 * 1000);
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

function buildTopPlans(payments: PaymentRecord[], mode: 'revenue' | 'count') {
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

    if (!parsed.createdAt || !parsed.id) {
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
  return value.replace(/[%+\r\n]/g, ' ').slice(0, 140);
}

function sanitizeReceiptItemName(value: string) {
  return value.replace(/[\r\n]/g, ' ').slice(0, 128);
}

function toOptionalString(value: unknown) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return String(value);
}

function resolvePaymentState(
  response: Record<string, unknown>,
  payment: PaymentRecord,
  options: { refundedAmount?: number },
) {
  const gatewayStatus = toOptionalString(response.Status) ?? payment.gatewayStatus;
  const gatewayErrorCode =
    toOptionalString(response.ErrorCode) ?? payment.gatewayErrorCode;
  const gatewayMessage =
    toOptionalString(response.Message) ?? payment.gatewayMessage;
  const gatewayDetails =
    toOptionalString(response.Details) ?? payment.gatewayDetails;
  const paymentUrl =
    toOptionalString(response.PaymentURL) ??
    payment.paymentUrl ??
    payment.formUrl;

  switch (gatewayStatus) {
    case 'CONFIRMED':
      return {
        status: PaymentOrderStatus.PAID,
        gatewayStatus,
        gatewayErrorCode,
        gatewayMessage,
        gatewayDetails,
        paymentUrl,
        paidAt: payment.paidAt ?? new Date(),
        failedAt: null,
        refundedAt: null,
        refundedAmount: payment.refundedAmount,
      };
    case 'AUTHORIZED':
    case 'NEW':
    case '3DS_CHECKING':
      return {
        status:
          payment.status === PaymentOrderStatus.REDIRECT_READY ||
          payment.status === PaymentOrderStatus.FORM_REGISTERED
            ? PaymentOrderStatus.REDIRECTED
            : PaymentOrderStatus.PROCESSING,
        gatewayStatus,
        gatewayErrorCode,
        gatewayMessage,
        gatewayDetails,
        paymentUrl,
        paidAt: payment.paidAt,
        failedAt: payment.failedAt,
        refundedAt: payment.refundedAt,
        refundedAmount: payment.refundedAmount,
      };
    case 'REFUNDED':
    case 'REVERSED':
      return {
        status: PaymentOrderStatus.REFUNDED,
        gatewayStatus,
        gatewayErrorCode,
        gatewayMessage,
        gatewayDetails,
        paymentUrl,
        paidAt: payment.paidAt,
        failedAt: payment.failedAt,
        refundedAt: payment.refundedAt ?? new Date(),
        refundedAmount: options.refundedAmount ?? payment.amount,
      };
    case 'CANCELED':
      return {
        status: PaymentOrderStatus.CANCELLED,
        gatewayStatus,
        gatewayErrorCode,
        gatewayMessage,
        gatewayDetails,
        paymentUrl,
        paidAt: payment.paidAt,
        failedAt: payment.failedAt ?? new Date(),
        refundedAt: payment.refundedAt,
        refundedAmount: payment.refundedAmount,
      };
    case 'DEADLINE_EXPIRED':
    case 'EXPIRED':
      return {
        status: PaymentOrderStatus.EXPIRED,
        gatewayStatus,
        gatewayErrorCode,
        gatewayMessage,
        gatewayDetails,
        paymentUrl,
        paidAt: payment.paidAt,
        failedAt: payment.failedAt ?? new Date(),
        refundedAt: payment.refundedAt,
        refundedAmount: payment.refundedAmount,
      };
    case 'REJECTED':
    case 'PROCESSING_ERROR':
      return {
        status: PaymentOrderStatus.FAILED,
        gatewayStatus,
        gatewayErrorCode,
        gatewayMessage,
        gatewayDetails,
        paymentUrl,
        paidAt: payment.paidAt,
        failedAt: payment.failedAt ?? new Date(),
        refundedAt: payment.refundedAt,
        refundedAmount: payment.refundedAmount,
      };
    default:
      return {
        status: payment.status,
        gatewayStatus,
        gatewayErrorCode,
        gatewayMessage,
        gatewayDetails,
        paymentUrl,
        paidAt: payment.paidAt,
        failedAt: payment.failedAt,
        refundedAt: payment.refundedAt,
        refundedAmount: payment.refundedAmount,
      };
  }
}

function shouldIssueMembership(payment: PaymentRecord) {
  return payment.status === PaymentOrderStatus.PAID && !payment.membershipIssuedAt;
}

function canRefund(payment: PaymentRecord) {
  return (
    payment.gatewayProvider === 'TBANK' &&
    payment.status === PaymentOrderStatus.PAID &&
    payment.refundedAmount < payment.amount
  );
}

function resolveLedgerTimestamp(payment: PaymentRecord) {
  return (
    payment.refundedAt?.toISOString() ??
    payment.paidAt?.toISOString() ??
    payment.failedAt?.toISOString() ??
    payment.createdAt.toISOString()
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
    case PaymentOrderStatus.REFUNDED:
      return {
        label: 'Платёж возвращён',
        tone: 'muted',
        message:
          'Возврат выполнен. Абонемент переведён в историю, а QR-код отключён.',
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
    case PaymentOrderStatus.PROCESSING:
    case PaymentOrderStatus.REDIRECTED:
      return {
        label: 'Ожидаем результат',
        tone: 'warning',
        message: 'Платёж обрабатывается. Обновляем данные у платёжного шлюза.',
      };
    case PaymentOrderStatus.REDIRECT_READY:
    case PaymentOrderStatus.FORM_REGISTERED:
    case PaymentOrderStatus.CREATED:
      return {
        label: 'Платёж создан',
        tone: 'warning',
        message: 'Переходим к оплате через банковскую страницу.',
      };
  }
}
