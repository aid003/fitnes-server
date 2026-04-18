import { BadGatewayException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
    revokeMembershipAfterRefund: jest.Mock;
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
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      paymentOrderEvent: {
        create: jest.fn(),
      },
    };

    configService = {
      get: jest.fn((key: string) => {
        switch (key) {
          case 'TBANK_TERMINAL_KEY':
            return 'TBankTest';
          case 'TBANK_PASSWORD':
            return 'password';
          case 'TBANK_API_URL':
            return 'https://securepay.tinkoff.ru/v2';
          case 'TBANK_REQUEST_TIMEOUT_MS':
            return '10000';
          case 'TBANK_NOTIFICATION_URL':
            return 'https://api.example.test/payments/webhooks/tbank';
          case 'TBANK_SUCCESS_URL':
          case 'TBANK_FAIL_URL':
            return 'https://app.example.test/payments/result';
          case 'TBANK_PAY_TYPE':
            return 'O';
          case 'TBANK_LANGUAGE':
            return 'ru';
          case 'TBANK_RECEIPT_TAXATION':
          case 'TBANK_TAXATION':
            return 'osn';
          case 'TBANK_RECEIPT_ITEM_TAX':
            return 'none';
          case 'TBANK_RECEIPT_PAYMENT_METHOD':
            return 'advance';
          case 'TBANK_RECEIPT_PAYMENT_OBJECT':
            return 'payment';
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
      revokeMembershipAfterRefund: jest.fn(),
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

  it('creates T-Bank redirect session and stores gateway payment id', async () => {
    prismaService.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      name: 'User',
      phone: '+79991234567',
    });
    prismaService.passPlan.findFirst.mockResolvedValue({
      id: 'plan-1',
      title: '1 месяц',
      subtitle: 'Безлимит',
      description: null,
      price: 849000,
      currency: 'RUB',
      billingType: 'FIXED_TERM',
      durationValue: 1,
      durationUnit: 'MONTH',
      group: {
        title: 'Group',
        variant: {
          title: 'Variant',
          category: {
            title: 'Category',
          },
        },
      },
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
        Success: true,
        ErrorCode: '0',
        Status: 'NEW',
        PaymentId: '700001',
        PaymentURL: 'https://pay.tbank.ru/new/test',
      }),
    });

    const result = await paymentsService.createPassPayment('user-1', 'plan-1');

    expect(result.formUrl).toBe('https://pay.tbank.ru/new/test');
    expect(prismaService.paymentOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          gatewayPaymentId: '700001',
          status: PaymentOrderStatus.REDIRECT_READY,
          gatewayStatus: 'NEW',
        }),
      }),
    );

    const [, fetchInit] = (global.fetch as jest.Mock).mock.calls[0];
    const payload = JSON.parse(fetchInit.body as string);
    expect(payload.TerminalKey).toBe('TBankTest');
    expect(payload.Amount).toBe(849000);
    expect(payload.SuccessURL).toContain('/payments/result?');
    expect(payload.SuccessURL).toContain('paymentId=');
    expect(payload.SuccessURL).toContain('result=success');
    expect(payload.FailURL).toContain('/payments/result?');
    expect(payload.FailURL).toContain('paymentId=');
    expect(payload.FailURL).toContain('result=fail');
    expect(payload.PaymentURL).toBeUndefined();
    expect(payload.PayType).toBe('O');
    expect(payload.Language).toBe('ru');
    expect(payload.Receipt.Taxation).toBe('osn');
    expect(payload.Receipt.Phone).toBe('+79991234567');
    expect(payload.Receipt.Items[0].Tax).toBe('none');
    expect(payload.Receipt.Items[0].PaymentMethod).toBe('advance');
    expect(payload.Receipt.Items[0].PaymentObject).toBe('payment');
    expect(payload.Token).toHaveLength(64);
  });

  it('syncs CONFIRMED state and issues membership once', async () => {
    prismaService.paymentOrder.findUnique.mockResolvedValue(
      createPaymentRecord({
        id: 'payment-1',
        userId: 'user-1',
        gatewayProvider: 'TBANK',
        gatewayPaymentId: '700001',
        status: PaymentOrderStatus.REDIRECT_READY,
      }),
    );
    prismaService.paymentOrder.update
      .mockResolvedValueOnce(
        createPaymentRecord({
          id: 'payment-1',
          userId: 'user-1',
          gatewayProvider: 'TBANK',
          gatewayPaymentId: '700001',
          status: PaymentOrderStatus.PAID,
          gatewayStatus: 'CONFIRMED',
          paidAt: new Date('2026-04-03T10:00:00.000Z'),
        }),
      )
      .mockResolvedValueOnce(
        createPaymentRecord({
          id: 'payment-1',
          userId: 'user-1',
          gatewayProvider: 'TBANK',
          gatewayPaymentId: '700001',
          status: PaymentOrderStatus.PAID,
          gatewayStatus: 'CONFIRMED',
          paidAt: new Date('2026-04-03T10:00:00.000Z'),
          membershipId: 'membership-1',
          membershipIssuedAt: new Date('2026-04-03T10:00:01.000Z'),
        }),
      );
    membershipsService.issueMembershipFromPayment.mockResolvedValue({
      id: 'membership-1',
    });
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        Success: true,
        ErrorCode: '0',
        Status: 'CONFIRMED',
        PaymentId: '700001',
      }),
    });

    const result = await paymentsService.confirmPayment('user-1', 'payment-1');

    expect(result.status).toBe(PaymentOrderStatus.PAID);
    expect(membershipsService.issueMembershipFromPayment).toHaveBeenCalledTimes(1);
  });

  it('issues separate memberships for two paid orders of the same plan', async () => {
    prismaService.paymentOrder.findUnique
      .mockResolvedValueOnce(
        createPaymentRecord({
          id: 'payment-1',
          userId: 'user-1',
          passPlanId: 'plan-1',
          gatewayProvider: 'TBANK',
          gatewayPaymentId: '700001',
          status: PaymentOrderStatus.REDIRECT_READY,
        }),
      )
      .mockResolvedValueOnce(
        createPaymentRecord({
          id: 'payment-2',
          userId: 'user-1',
          passPlanId: 'plan-1',
          gatewayProvider: 'TBANK',
          gatewayPaymentId: '700002',
          status: PaymentOrderStatus.REDIRECT_READY,
        }),
      );
    prismaService.paymentOrder.update
      .mockResolvedValueOnce(
        createPaymentRecord({
          id: 'payment-1',
          userId: 'user-1',
          passPlanId: 'plan-1',
          gatewayProvider: 'TBANK',
          gatewayPaymentId: '700001',
          status: PaymentOrderStatus.PAID,
          gatewayStatus: 'CONFIRMED',
          paidAt: new Date('2026-04-03T10:00:00.000Z'),
        }),
      )
      .mockResolvedValueOnce(
        createPaymentRecord({
          id: 'payment-1',
          userId: 'user-1',
          passPlanId: 'plan-1',
          gatewayProvider: 'TBANK',
          gatewayPaymentId: '700001',
          status: PaymentOrderStatus.PAID,
          gatewayStatus: 'CONFIRMED',
          paidAt: new Date('2026-04-03T10:00:00.000Z'),
          membershipId: 'membership-1',
          membershipIssuedAt: new Date('2026-04-03T10:00:01.000Z'),
        }),
      )
      .mockResolvedValueOnce(
        createPaymentRecord({
          id: 'payment-2',
          userId: 'user-1',
          passPlanId: 'plan-1',
          gatewayProvider: 'TBANK',
          gatewayPaymentId: '700002',
          status: PaymentOrderStatus.PAID,
          gatewayStatus: 'CONFIRMED',
          paidAt: new Date('2026-04-03T10:05:00.000Z'),
        }),
      )
      .mockResolvedValueOnce(
        createPaymentRecord({
          id: 'payment-2',
          userId: 'user-1',
          passPlanId: 'plan-1',
          gatewayProvider: 'TBANK',
          gatewayPaymentId: '700002',
          status: PaymentOrderStatus.PAID,
          gatewayStatus: 'CONFIRMED',
          paidAt: new Date('2026-04-03T10:05:00.000Z'),
          membershipId: 'membership-2',
          membershipIssuedAt: new Date('2026-04-03T10:05:01.000Z'),
        }),
      );
    membershipsService.issueMembershipFromPayment
      .mockResolvedValueOnce({ id: 'membership-1' })
      .mockResolvedValueOnce({ id: 'membership-2' });
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          Success: true,
          ErrorCode: '0',
          Status: 'CONFIRMED',
          PaymentId: '700001',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          Success: true,
          ErrorCode: '0',
          Status: 'CONFIRMED',
          PaymentId: '700002',
        }),
      });

    const first = await paymentsService.confirmPayment('user-1', 'payment-1');
    const second = await paymentsService.confirmPayment('user-1', 'payment-2');

    expect(first.membershipId).toBe('membership-1');
    expect(second.membershipId).toBe('membership-2');
    expect(membershipsService.issueMembershipFromPayment).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        userId: 'user-1',
        passPlanId: 'plan-1',
      }),
    );
    expect(membershipsService.issueMembershipFromPayment).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        userId: 'user-1',
        passPlanId: 'plan-1',
      }),
    );
  });

  it('does not issue membership again when the same payment already has a membership id', async () => {
    prismaService.paymentOrder.findUnique.mockResolvedValue(
      createPaymentRecord({
        id: 'payment-1',
        userId: 'user-1',
        gatewayProvider: 'TBANK',
        gatewayPaymentId: '700001',
        status: PaymentOrderStatus.PAID,
        gatewayStatus: 'CONFIRMED',
        paidAt: new Date('2026-04-03T10:00:00.000Z'),
        membershipId: 'membership-1',
        membershipIssuedAt: null,
      }),
    );
    prismaService.paymentOrder.update.mockResolvedValue(
      createPaymentRecord({
        id: 'payment-1',
        userId: 'user-1',
        gatewayProvider: 'TBANK',
        gatewayPaymentId: '700001',
        status: PaymentOrderStatus.PAID,
        gatewayStatus: 'CONFIRMED',
        paidAt: new Date('2026-04-03T10:00:00.000Z'),
        membershipId: 'membership-1',
        membershipIssuedAt: null,
      }),
    );
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        Success: true,
        ErrorCode: '0',
        Status: 'CONFIRMED',
        PaymentId: '700001',
      }),
    });

    const result = await paymentsService.confirmPayment('user-1', 'payment-1');

    expect(result.membershipId).toBe('membership-1');
    expect(membershipsService.issueMembershipFromPayment).not.toHaveBeenCalled();
    expect(membershipsService.attachQrSnapshotFromPayment).toHaveBeenCalledWith(
      'membership-1',
      'payment-1',
    );
  });

  it('rejects webhook state changes when token is invalid', async () => {
    prismaService.paymentOrder.findFirst.mockResolvedValue(
      createPaymentRecord({
        id: 'payment-1',
        userId: 'user-1',
        gatewayProvider: 'TBANK',
        gatewayPaymentId: '700001',
        status: PaymentOrderStatus.REDIRECT_READY,
      }),
    );

    const response = await paymentsService.handleTBankWebhook({
      PaymentId: '700001',
      Status: 'CONFIRMED',
      Success: true,
      ErrorCode: '0',
      Amount: 849000,
      OrderId: 'fit-order',
      TerminalKey: 'TBankTest',
      Token: 'bad-token',
    });

    expect(response).toBe('OK');
    expect(prismaService.paymentOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          notificationTokenValid: false,
        }),
      }),
    );
    expect(membershipsService.issueMembershipFromPayment).not.toHaveBeenCalled();
  });

  it('refunds paid T-Bank payment via Cancel', async () => {
    prismaService.paymentOrder.findUnique.mockResolvedValue(
      createPaymentRecord({
        id: 'payment-1',
        userId: 'user-1',
        gatewayProvider: 'TBANK',
        gatewayPaymentId: '700001',
        membershipId: 'membership-1',
        status: PaymentOrderStatus.PAID,
        gatewayStatus: 'CONFIRMED',
        paidAt: new Date('2026-04-03T10:00:00.000Z'),
      }),
    );
    prismaService.paymentOrder.update.mockResolvedValue(
      createPaymentRecord({
        id: 'payment-1',
        userId: 'user-1',
        gatewayProvider: 'TBANK',
        gatewayPaymentId: '700001',
        membershipId: 'membership-1',
        status: PaymentOrderStatus.REFUNDED,
        gatewayStatus: 'REFUNDED',
        refundedAmount: 849000,
        refundedAt: new Date('2026-04-03T11:00:00.000Z'),
      }),
    );
    prismaService.paymentOrder.findUnique.mockResolvedValueOnce(
      createPaymentRecord({
        id: 'payment-1',
        userId: 'user-1',
        gatewayProvider: 'TBANK',
        gatewayPaymentId: '700001',
        membershipId: 'membership-1',
        status: PaymentOrderStatus.PAID,
        gatewayStatus: 'CONFIRMED',
        paidAt: new Date('2026-04-03T10:00:00.000Z'),
      }),
    );
    prismaService.paymentOrder.findUnique.mockResolvedValueOnce({
      ...createPaymentRecord({
        id: 'payment-1',
        userId: 'user-1',
        gatewayProvider: 'TBANK',
        gatewayPaymentId: '700001',
        membershipId: 'membership-1',
        status: PaymentOrderStatus.REFUNDED,
        gatewayStatus: 'REFUNDED',
        refundedAmount: 849000,
        refundedAt: new Date('2026-04-03T11:00:00.000Z'),
      }),
      events: [],
    });
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        Success: true,
        ErrorCode: '0',
        Status: 'REFUNDED',
        PaymentId: '700001',
      }),
    });

    const result = await paymentsService.refundAdminPayment('payment-1');

    expect(result.status).toBe(PaymentOrderStatus.REFUNDED);
    expect(membershipsService.revokeMembershipAfterRefund).toHaveBeenCalledWith(
      'membership-1',
    );
    expect(prismaService.paymentOrderEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'REFUND_REQUEST',
        }),
      }),
    );
  });

  it('maps admin ledger diagnostics for unfinished orders', async () => {
    prismaService.paymentOrder.findMany.mockResolvedValue([
      createPaymentRecord({
        id: 'payment-redirect',
        status: PaymentOrderStatus.REDIRECT_READY,
        gatewayStatus: 'NEW',
        membershipId: null,
        membershipIssuedAt: null,
      }),
    ]);

    const result = await paymentsService.getAdminPaymentsLedger({
      range: '30d',
      limit: 20,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        adminDiagnosis: 'Оплата не завершена',
        adminReason: 'Пользователь перешёл к оплате, но платёж не завершён.',
        isCompletedPayment: false,
        isIssueActionRequired: false,
      }),
    );
  });

  it('marks paid order without issuance as admin action required', async () => {
    prismaService.paymentOrder.findUnique.mockResolvedValue({
      ...createPaymentRecord({
        id: 'payment-1',
        status: PaymentOrderStatus.PAID,
        gatewayStatus: 'CONFIRMED',
        membershipId: null,
        membershipIssuedAt: null,
        paidAt: new Date('2026-04-03T10:00:00.000Z'),
      }),
      events: [],
    });

    const result = await paymentsService.getAdminPaymentDetails('payment-1');

    expect(result).toEqual(
      expect.objectContaining({
        adminDiagnosis: 'Оплата подтверждена, абонемент не выдан',
        adminReason:
          'Банк подтвердил оплату, но запись о выдаче абонемента отсутствует.',
        isCompletedPayment: true,
        isIssueActionRequired: true,
      }),
    );
  });

  it('revokes membership when webhook reports refunded payment', async () => {
    const notification = {
      PaymentId: '700001',
      Status: 'REFUNDED',
      Success: true,
      ErrorCode: '0',
      Amount: 849000,
      OrderId: 'fit-1',
      TerminalKey: 'TBankTest',
    } as Record<string, unknown>;
    notification.Token = (paymentsService as any).createTBankToken(notification);

    prismaService.paymentOrder.findFirst.mockResolvedValue(
      createPaymentRecord({
        id: 'payment-1',
        userId: 'user-1',
        gatewayProvider: 'TBANK',
        gatewayPaymentId: '700001',
        membershipId: 'membership-1',
        status: PaymentOrderStatus.PAID,
        gatewayStatus: 'CONFIRMED',
        paidAt: new Date('2026-04-03T10:00:00.000Z'),
      }),
    );
    prismaService.paymentOrder.update
      .mockResolvedValueOnce(
        createPaymentRecord({
          id: 'payment-1',
          userId: 'user-1',
          gatewayProvider: 'TBANK',
          gatewayPaymentId: '700001',
          membershipId: 'membership-1',
          status: PaymentOrderStatus.PAID,
          gatewayStatus: 'CONFIRMED',
          paidAt: new Date('2026-04-03T10:00:00.000Z'),
        }),
      )
      .mockResolvedValueOnce(
        createPaymentRecord({
          id: 'payment-1',
          userId: 'user-1',
          gatewayProvider: 'TBANK',
          gatewayPaymentId: '700001',
          membershipId: 'membership-1',
          status: PaymentOrderStatus.REFUNDED,
          gatewayStatus: 'REFUNDED',
          refundedAmount: 849000,
          refundedAt: new Date('2026-04-03T11:00:00.000Z'),
        }),
      );

    const response = await paymentsService.handleTBankWebhook(
      notification as never,
    );

    expect(response).toBe('OK');
    expect(membershipsService.revokeMembershipAfterRefund).toHaveBeenCalledWith(
      'membership-1',
    );
  });

  it('throws when T-Bank credentials are missing', async () => {
    configService.get.mockReturnValue(undefined);
    prismaService.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      name: 'User',
    });
    prismaService.passPlan.findFirst.mockResolvedValue({
      id: 'plan-1',
      title: '1 месяц',
      subtitle: 'Безлимит',
      description: null,
      price: 849000,
      currency: 'RUB',
      billingType: 'FIXED_TERM',
      durationValue: 1,
      durationUnit: 'MONTH',
      group: {
        title: 'Group',
        variant: {
          title: 'Variant',
          category: {
            title: 'Category',
          },
        },
      },
    });
    prismaService.paymentOrder.create.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({
        ...createPaymentRecord(),
        ...data,
      }),
    );
    prismaService.paymentOrder.update.mockResolvedValue(createPaymentRecord());

    await expect(
      paymentsService.createPassPayment('user-1', 'plan-1'),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('sends RedirectDueDate in T-Bank datetime format', async () => {
    prismaService.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      name: 'User',
    });
    prismaService.passPlan.findFirst.mockResolvedValue({
      id: 'plan-1',
      title: '1 месяц',
      subtitle: 'Безлимит',
      description: null,
      price: 849000,
      currency: 'RUB',
      billingType: 'FIXED_TERM',
      durationValue: 1,
      durationUnit: 'MONTH',
      group: {
        title: 'Group',
        variant: {
          title: 'Variant',
          category: {
            title: 'Category',
          },
        },
      },
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
        Success: true,
        ErrorCode: '0',
        Status: 'NEW',
        PaymentId: '700001',
        PaymentURL: 'https://pay.tbank.ru/new/test',
      }),
    });

    await paymentsService.createPassPayment('user-1', 'plan-1');

    const [, fetchInit] = (global.fetch as jest.Mock).mock.calls[0];
    const payload = JSON.parse(fetchInit.body as string);
    expect(payload.RedirectDueDate).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/,
    );
  });

  it('fails fast when init payload has invalid amount and receipt total mismatch', () => {
    expect(() =>
      (paymentsService as any).validateInitPayload({
        TerminalKey: 'TBankTest',
        Amount: 10,
        OrderId: 'fit-1',
        Description: 'Оплата',
        PayType: 'O',
        Language: 'ru',
        NotificationURL: 'https://api.example.test/payments/webhooks/tbank',
        SuccessURL: 'https://app.example.test/payments/result',
        FailURL: 'https://app.example.test/payments/result',
        RedirectDueDate: '2026-04-07T12:00:00+03:00',
        DATA: {
          paymentId: 'payment-1',
        },
        Receipt: {
          Email: 'user@example.com',
          Taxation: 'osn',
          Items: [
            {
              Name: 'Абонемент',
              Amount: 9,
            },
          ],
        },
      }),
    ).toThrow(BadGatewayException);
  });

  it('uses configured request timeout and validates pay type/language', () => {
    expect((paymentsService as any).resolveTBankRequestTimeoutMs()).toBe(10000);
    expect((paymentsService as any).resolveTBankPayType()).toBe('O');
    expect((paymentsService as any).resolveTBankLanguage()).toBe('ru');
  });
});

function createPaymentRecord(overrides: Record<string, any> = {}) {
  return {
    id: 'payment-1',
    userId: 'user-1',
    passPlanId: 'plan-1',
    membershipId: null,
    gatewayProvider: 'TBANK',
    merchantOrderNumber: 'fit-1',
    gatewayOrderId: null,
    gatewayPaymentId: '700001',
    amount: 849000,
    currency: 'RUB',
    status: PaymentOrderStatus.CREATED,
    gatewayOrderStatus: null,
    gatewayPaymentState: null,
    gatewayStatus: null,
    gatewayErrorCode: null,
    gatewayMessage: null,
    gatewayDetails: null,
    actionCode: null,
    actionCodeDescription: null,
    formUrl: 'https://pay.tbank.ru/new/test',
    paymentUrl: 'https://pay.tbank.ru/new/test',
    returnUrl: 'https://app.example.test/payments/result?paymentId=payment-1&result=success',
    failUrl: 'https://app.example.test/payments/result?paymentId=payment-1&result=fail',
    planTitle: '1 месяц',
    planSubtitle: 'Безлимит',
    planDescription: null,
    payerEmail: 'user@example.com',
    payerPhone: '+79991234567',
    fiscalPayload: null,
    receiptPayload: {
      Email: 'user@example.com',
      Phone: '+79991234567',
      Taxation: 'osn',
      Items: [],
    },
    refundedAmount: 0,
    notificationTokenValid: null,
    lastNotificationAt: null,
    createdAt: new Date('2026-04-03T09:00:00.000Z'),
    updatedAt: new Date('2026-04-03T09:00:00.000Z'),
    redirectedAt: null,
    paidAt: null,
    failedAt: null,
    refundedAt: null,
    membershipIssuedAt: null,
    user: {
      id: 'user-1',
      name: 'User',
      email: 'user@example.com',
      phone: '+79991234567',
    },
    passPlan: {
      id: 'plan-1',
      title: '1 месяц',
      subtitle: 'Безлимит',
      billingType: 'FIXED_TERM',
      durationValue: 1,
      durationUnit: 'MONTH',
      group: {
        title: 'Group',
        variant: {
          title: 'Variant',
          category: {
            title: 'Category',
          },
        },
      },
    },
    ...overrides,
  };
}
