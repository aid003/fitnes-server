import { ConfigService } from '@nestjs/config';
import { InternalServerErrorException } from '@nestjs/common';
import { PaymentOrderStatus } from '@prisma/client';
import { MembershipsService } from '../memberships/memberships.service';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from './payments.service';

describe('PaymentsService', () => {
  let paymentsService: PaymentsService;
  let prismaService: Record<string, any>;
  let configService: { get: jest.Mock };
  let membershipsService: {
    issueMembershipFromPayment: jest.Mock;
    attachQrSnapshotFromPayment: jest.Mock;
  };

  beforeEach(() => {
    prismaService = {
      user: {
        findUnique: jest.fn(),
      },
      passPlan: {
        findFirst: jest.fn(),
      },
      paymentOrder: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
    };

    configService = {
      get: jest.fn((key: string) => {
        switch (key) {
          case 'ALFA_GATEWAY_BASE_URL':
            return 'https://gateway.example.test/payment/rest';
          case 'ALFA_GATEWAY_USERNAME':
            return 'user';
          case 'ALFA_GATEWAY_PASSWORD':
            return 'pass';
          case 'FRONTEND_ORIGIN':
            return 'https://app.example.test';
          default:
            return undefined;
        }
      }),
    };

    membershipsService = {
      issueMembershipFromPayment: jest.fn(),
      attachQrSnapshotFromPayment: jest.fn(),
    };

    paymentsService = new PaymentsService(
      prismaService as PrismaService,
      configService as ConfigService,
      membershipsService as unknown as MembershipsService,
    );

    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('stores payment in kopecks and sends gateway amount in kopecks', async () => {
    prismaService.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
    });
    prismaService.passPlan.findFirst.mockResolvedValue({
      id: 'plan-1',
      title: '1 месяц (безлимит)',
      subtitle: '2 гостевых визита',
      description: null,
      price: 849000,
      currency: 'RUB',
    });
    prismaService.paymentOrder.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        ...createPaymentRecord(),
        ...data,
      }),
    );
    prismaService.paymentOrder.update.mockResolvedValue(createPaymentRecord());
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        errorCode: 0,
        orderId: 'gateway-order-1',
        formUrl: 'https://gateway.example.test/form',
      }),
    });

    await paymentsService.createPassPayment('user-1', 'plan-1');

    expect(prismaService.paymentOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: 849000,
          currency: 'RUB',
        }),
      }),
    );

    const [, fetchInit] = (global.fetch as jest.Mock).mock.calls[0];
    const body = fetchInit.body as URLSearchParams;
    expect(body.get('amount')).toBe('849000');
  });

  it('returns payment amount in rubles for API consumers', async () => {
    prismaService.paymentOrder.findUnique.mockResolvedValue(
      createPaymentRecord({
        userId: 'user-1',
        amount: 849000,
        status: PaymentOrderStatus.CREATED,
      }),
    );

    const result = await paymentsService.getPaymentStatus('user-1', 'payment-1');

    expect(result.amount).toBe(8490);
  });

  it('treats gateway deposited amount as kopecks when confirming payment', async () => {
    prismaService.paymentOrder.findUnique.mockResolvedValue(
      createPaymentRecord({
        id: 'payment-1',
        userId: 'user-1',
        amount: 849000,
        status: PaymentOrderStatus.FORM_REGISTERED,
        gatewayOrderId: 'gateway-order-1',
      }),
    );
    prismaService.paymentOrder.update
      .mockResolvedValueOnce(
        createPaymentRecord({
          id: 'payment-1',
          userId: 'user-1',
          amount: 849000,
          status: PaymentOrderStatus.PAID,
          gatewayOrderId: 'gateway-order-1',
          paidAt: new Date('2026-03-19T12:00:00.000Z'),
        }),
      )
      .mockResolvedValueOnce(
        createPaymentRecord({
          id: 'payment-1',
          userId: 'user-1',
          amount: 849000,
          status: PaymentOrderStatus.PAID,
          gatewayOrderId: 'gateway-order-1',
          paidAt: new Date('2026-03-19T12:00:00.000Z'),
          membershipId: 'membership-1',
          membershipIssuedAt: new Date('2026-03-19T12:00:01.000Z'),
        }),
      );
    membershipsService.issueMembershipFromPayment.mockResolvedValue({
      id: 'membership-1',
    });
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        errorCode: 0,
        orderStatus: 1,
        paymentAmountInfo: {
          paymentState: 'APPROVED',
          depositedAmount: 849000,
        },
      }),
    });

    const result = await paymentsService.confirmPayment('user-1', 'payment-1');

    expect(prismaService.paymentOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PaymentOrderStatus.PAID,
        }),
      }),
    );
    expect(result.amount).toBe(8490);
    expect(membershipsService.issueMembershipFromPayment).toHaveBeenCalled();
  });

  it('returns PAID even when QR snapshot generation fails', async () => {
    prismaService.paymentOrder.findUnique.mockResolvedValue(
      createPaymentRecord({
        id: 'payment-1',
        userId: 'user-1',
        amount: 849000,
        status: PaymentOrderStatus.FORM_REGISTERED,
        gatewayOrderId: 'gateway-order-1',
      }),
    );
    prismaService.paymentOrder.update
      .mockResolvedValueOnce(
        createPaymentRecord({
          id: 'payment-1',
          userId: 'user-1',
          amount: 849000,
          status: PaymentOrderStatus.PAID,
          gatewayOrderId: 'gateway-order-1',
          paidAt: new Date('2026-03-19T12:00:00.000Z'),
        }),
      )
      .mockResolvedValueOnce(
        createPaymentRecord({
          id: 'payment-1',
          userId: 'user-1',
          amount: 849000,
          status: PaymentOrderStatus.PAID,
          gatewayOrderId: 'gateway-order-1',
          paidAt: new Date('2026-03-19T12:00:00.000Z'),
          membershipId: 'membership-1',
          membershipIssuedAt: new Date('2026-03-19T12:00:01.000Z'),
        }),
      );
    membershipsService.issueMembershipFromPayment.mockResolvedValue({
      id: 'membership-1',
    });
    membershipsService.attachQrSnapshotFromPayment.mockRejectedValue(
      new InternalServerErrorException('MEMBERSHIP_QR_SECRET is not configured'),
    );
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        errorCode: 0,
        orderStatus: 2,
      }),
    });

    const result = await paymentsService.confirmPayment('user-1', 'payment-1');

    expect(result.status).toBe(PaymentOrderStatus.PAID);
    expect(result.membershipId).toBe('membership-1');
    expect(membershipsService.attachQrSnapshotFromPayment).toHaveBeenCalledWith(
      'membership-1',
      'payment-1',
    );
  });

  it('retries QR snapshot generation for already issued paid membership', async () => {
    prismaService.paymentOrder.findUnique.mockResolvedValue(
      createPaymentRecord({
        id: 'payment-1',
        userId: 'user-1',
        amount: 849000,
        status: PaymentOrderStatus.PAID,
        gatewayOrderId: 'gateway-order-1',
        membershipId: 'membership-1',
        paidAt: new Date('2026-03-19T12:00:00.000Z'),
        membershipIssuedAt: new Date('2026-03-19T12:00:01.000Z'),
      }),
    );
    prismaService.paymentOrder.update.mockResolvedValue(
      createPaymentRecord({
        id: 'payment-1',
        userId: 'user-1',
        amount: 849000,
        status: PaymentOrderStatus.PAID,
        gatewayOrderId: 'gateway-order-1',
        membershipId: 'membership-1',
        paidAt: new Date('2026-03-19T12:00:00.000Z'),
        membershipIssuedAt: new Date('2026-03-19T12:00:01.000Z'),
      }),
    );
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        errorCode: 0,
        orderStatus: 2,
      }),
    });

    const result = await paymentsService.confirmPayment('user-1', 'payment-1');

    expect(result.status).toBe(PaymentOrderStatus.PAID);
    expect(membershipsService.issueMembershipFromPayment).not.toHaveBeenCalled();
    expect(membershipsService.attachQrSnapshotFromPayment).toHaveBeenCalledWith(
      'membership-1',
      'payment-1',
    );
  });

  it('builds admin overview from paid orders only and compares with previous period', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-19T12:00:00.000Z'));
    prismaService.paymentOrder.findMany.mockResolvedValue([
      createPaymentRecord({
        id: 'current-1',
        passPlanId: 'plan-1',
        amount: 500000,
        status: PaymentOrderStatus.PAID,
        paidAt: new Date('2026-03-18T10:00:00.000Z'),
      }),
      createPaymentRecord({
        id: 'current-2',
        passPlanId: 'plan-1',
        amount: 300000,
        status: PaymentOrderStatus.PAID,
        paidAt: new Date('2026-03-17T10:00:00.000Z'),
      }),
      createPaymentRecord({
        id: 'previous-1',
        passPlanId: 'plan-2',
        planTitle: '8 занятий',
        amount: 200000,
        status: PaymentOrderStatus.PAID,
        paidAt: new Date('2026-02-15T10:00:00.000Z'),
      }),
    ]);
    prismaService.paymentOrder.count.mockResolvedValue(4);

    const result = await paymentsService.getAdminPaymentsOverview('30d');

    expect(result.totals.grossRevenue).toBe(8000);
    expect(result.totals.successfulPaymentsCount).toBe(2);
    expect(result.totals.averageCheck).toBe(4000);
    expect(result.totals.createdOrdersCount).toBe(4);
    expect(result.totals.paidConversionRate).toBe(50);
    expect(result.comparisons.grossRevenue.previous).toBe(2000);
    expect(result.comparisons.grossRevenue.delta).toBe(6000);
    expect(result.topPlans.byRevenue[0]).toEqual(
      expect.objectContaining({
        planId: 'plan-1',
        value: 8000,
      }),
    );
    expect(
      result.revenueSeries.find((entry: { date: string }) => entry.date === '2026-03-18')
        ?.value,
    ).toBe(5000);

    jest.useRealTimers();
  });

  it('returns admin ledger page with stable cursor pagination for equal paidAt timestamps', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-19T12:00:00.000Z'));
    prismaService.paymentOrder.findMany.mockResolvedValueOnce([
      createPaymentRecord({
        id: 'payment-3',
        paidAt: new Date('2026-03-19T10:00:00.000Z'),
        status: PaymentOrderStatus.PAID,
      }),
      createPaymentRecord({
        id: 'payment-2',
        paidAt: new Date('2026-03-19T10:00:00.000Z'),
        status: PaymentOrderStatus.PAID,
      }),
      createPaymentRecord({
        id: 'payment-1',
        paidAt: new Date('2026-03-18T10:00:00.000Z'),
        status: PaymentOrderStatus.PAID,
      }),
    ]);

    const firstPage = await paymentsService.getAdminPaymentsLedger({
      range: '30d',
      limit: 2,
    });

    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.items[0].paymentId).toBe('payment-3');
    expect(firstPage.items[1].paymentId).toBe('payment-2');
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    expect(prismaService.paymentOrder.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: PaymentOrderStatus.PAID,
        }),
        orderBy: [{ paidAt: 'desc' }, { id: 'desc' }],
        take: 3,
      }),
    );

    prismaService.paymentOrder.findMany.mockResolvedValueOnce([
      createPaymentRecord({
        id: 'payment-1',
        paidAt: new Date('2026-03-18T10:00:00.000Z'),
        status: PaymentOrderStatus.PAID,
      }),
    ]);

    const secondPage = await paymentsService.getAdminPaymentsLedger({
      range: '30d',
      limit: 2,
      cursor: firstPage.nextCursor ?? undefined,
    });

    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0].paymentId).toBe('payment-1');
    expect(prismaService.paymentOrder.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            {
              paidAt: {
                lt: new Date('2026-03-19T10:00:00.000Z'),
              },
            },
            {
              paidAt: new Date('2026-03-19T10:00:00.000Z'),
              id: {
                lt: 'payment-2',
              },
            },
          ],
        }),
      }),
    );

    jest.useRealTimers();
  });
});

function createPaymentRecord(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'payment-1',
    userId: 'user-1',
    passPlanId: 'plan-1',
    membershipId: null,
    merchantOrderNumber: 'merchant-order-1',
    gatewayOrderId: null,
    amount: 849000,
    currency: 'RUB',
    status: PaymentOrderStatus.CREATED,
    gatewayOrderStatus: null,
    gatewayPaymentState: null,
    actionCode: null,
    actionCodeDescription: null,
    formUrl: 'https://gateway.example.test/form',
    returnUrl: 'https://app.example.test/payments/result?paymentId=payment-1&result=success',
    failUrl: 'https://app.example.test/payments/result?paymentId=payment-1&result=fail',
    planTitle: '1 месяц (безлимит)',
    planSubtitle: '2 гостевых визита',
    planDescription: null,
    payerEmail: 'user@example.com',
    payerPhone: null,
    createdAt: new Date('2026-03-19T11:00:00.000Z'),
    updatedAt: new Date('2026-03-19T11:00:00.000Z'),
    redirectedAt: null,
    paidAt: null,
    failedAt: null,
    membershipIssuedAt: null,
    user: {
      id: 'user-1',
      name: 'Jane Doe',
      email: 'user@example.com',
    },
    passPlan: {
      id: 'plan-1',
      title: '1 месяц (безлимит)',
      subtitle: '2 гостевых визита',
      group: {
        title: 'Безлимит',
        variant: {
          title: 'Взрослые',
          category: {
            title: 'Бассейн',
          },
        },
      },
    },
    ...overrides,
  };
}
