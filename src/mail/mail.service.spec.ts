import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { MailService } from './mail.service';

jest.mock('nodemailer', () => ({
  createTransport: jest.fn(),
}));

describe('MailService', () => {
  const sendMail = jest.fn();
  const configValues: Record<string, string> = {
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '465',
    SMTP_SECURE: 'true',
    SMTP_USER: 'smtp-user',
    SMTP_PASSWORD: 'smtp-password',
    SMTP_FROM_EMAIL: 'noreply@example.com',
    SMTP_FROM_NAME: 'Эра Спорта',
  };

  beforeEach(() => {
    sendMail.mockReset();
    jest.mocked(nodemailer.createTransport).mockReturnValue({
      sendMail,
    } as unknown as nodemailer.Transporter);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('sends registration email with html and text templates', async () => {
    const service = new MailService(createConfigService());

    await service.sendRegistrationCode({
      to: 'user@example.com',
      recipientName: 'Анна',
      code: '123456',
      expiresAt: new Date('2026-03-19T12:15:00.000Z'),
    });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Эра Спорта: подтверждение регистрации',
        html: expect.stringContaining('123456'),
        text: expect.stringContaining('Код подтверждения: 123456'),
      }),
    );
  });

  it('sends recovery email with html and text templates', async () => {
    const service = new MailService(createConfigService());

    await service.sendPasswordRecoveryCode({
      to: 'user@example.com',
      recipientName: 'Анна',
      code: '654321',
      expiresAt: new Date('2026-03-19T12:15:00.000Z'),
    });

    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'user@example.com',
        subject: 'Эра Спорта: восстановление доступа',
        html: expect.stringContaining('654321'),
        text: expect.stringContaining('Код восстановления: 654321'),
      }),
    );
  });

  function createConfigService() {
    return {
      get: jest.fn((key: string) => configValues[key]),
    } as unknown as ConfigService;
  }
});
