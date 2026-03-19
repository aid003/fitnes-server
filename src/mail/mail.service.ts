import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

type AuthCodeEmailInput = {
  to: string;
  recipientName?: string;
  code: string;
  expiresAt: Date;
};

type AuthEmailTemplate = {
  subject: string;
  html: string;
  text: string;
};

@Injectable()
export class MailService {
  private transporter?: nodemailer.Transporter;

  constructor(private readonly configService: ConfigService) {}

  async sendRegistrationCode(input: AuthCodeEmailInput) {
    const template = buildRegistrationTemplate(input);

    await this.sendMail({
      to: input.to,
      ...template,
    });
  }

  async sendPasswordRecoveryCode(input: AuthCodeEmailInput) {
    const template = buildRecoveryTemplate(input);

    await this.sendMail({
      to: input.to,
      ...template,
    });
  }

  private async sendMail(input: {
    to: string;
    subject: string;
    html: string;
    text: string;
  }) {
    const transporter = this.getTransporter();
    const fromEmail = this.requireEnv('SMTP_FROM_EMAIL');
    const fromName =
      this.configService.get<string>('SMTP_FROM_NAME')?.trim() || 'Эра Спорта';

    try {
      await transporter.sendMail({
        from: `"${fromName}" <${fromEmail}>`,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      });
    } catch {
      throw new InternalServerErrorException(
        'Не удалось отправить письмо с кодом подтверждения',
      );
    }
  }

  private getTransporter() {
    if (this.transporter) {
      return this.transporter;
    }

    const options: SMTPTransport.Options = {
      host: this.requireEnv('SMTP_HOST'),
      port: Number(this.requireEnv('SMTP_PORT')),
      secure: parseBoolean(this.requireEnv('SMTP_SECURE')),
      auth: {
        user: this.requireEnv('SMTP_USER'),
        pass: this.requireEnv('SMTP_PASSWORD'),
      },
    };

    this.transporter = nodemailer.createTransport(options);

    return this.transporter;
  }

  private requireEnv(name: string) {
    const value = this.configService.get<string>(name)?.trim();

    if (!value) {
      throw new InternalServerErrorException(
        `Не задана обязательная переменная окружения ${name}`,
      );
    }

    return value;
  }
}

function buildRegistrationTemplate(
  input: AuthCodeEmailInput,
): AuthEmailTemplate {
  const greeting = input.recipientName
    ? `Здравствуйте, ${input.recipientName}!`
    : 'Здравствуйте!';
  const expiresLabel = formatExpiryLabel(input.expiresAt);
  const codeLine = `Код подтверждения: ${input.code}`;

  return {
    subject: 'Эра Спорта: подтверждение регистрации',
    html: buildHtmlTemplate({
      preheader:
        'Подтвердите регистрацию в приложении фитнес-клуба «Эра Спорта».',
      title: 'Подтвердите регистрацию',
      greeting,
      paragraphs: [
        'Мы получили запрос на создание аккаунта в приложении фитнес-клуба «Эра Спорта».',
        'Введите код ниже, чтобы подтвердить адрес электронной почты и завершить регистрацию.',
        `Код действует до ${expiresLabel}. Если вы не создавали аккаунт, просто проигнорируйте это письмо.`,
      ],
      code: input.code,
      note: 'Если письмо не отображается в папке «Входящие», проверьте раздел «Спам».',
    }),
    text: [
      greeting,
      '',
      'Мы получили запрос на создание аккаунта в приложении фитнес-клуба «Эра Спорта».',
      'Введите код ниже, чтобы подтвердить адрес электронной почты и завершить регистрацию.',
      codeLine,
      `Код действует до ${expiresLabel}.`,
      'Если вы не создавали аккаунт, просто проигнорируйте это письмо.',
      'Если письмо не отображается во «Входящих», проверьте папку «Спам».',
    ].join('\n'),
  };
}

function buildRecoveryTemplate(input: AuthCodeEmailInput): AuthEmailTemplate {
  const greeting = input.recipientName
    ? `Здравствуйте, ${input.recipientName}!`
    : 'Здравствуйте!';
  const expiresLabel = formatExpiryLabel(input.expiresAt);
  const codeLine = `Код восстановления: ${input.code}`;

  return {
    subject: 'Эра Спорта: восстановление доступа',
    html: buildHtmlTemplate({
      preheader: 'Код для подтверждения смены пароля в приложении «Эра Спорта».',
      title: 'Подтвердите смену пароля',
      greeting,
      paragraphs: [
        'Мы получили запрос на восстановление доступа к вашему аккаунту в приложении фитнес-клуба «Эра Спорта».',
        'Введите код ниже, чтобы подтвердить смену пароля.',
        `Код действует до ${expiresLabel}. Если вы не запрашивали смену пароля, рекомендуем проигнорировать письмо и проверить безопасность аккаунта.`,
      ],
      code: input.code,
      note: 'После входа в аккаунт рекомендуем установить новый уникальный пароль и не передавать его третьим лицам.',
    }),
    text: [
      greeting,
      '',
      'Мы получили запрос на восстановление доступа к вашему аккаунту в приложении фитнес-клуба «Эра Спорта».',
      'Введите код ниже, чтобы подтвердить смену пароля.',
      codeLine,
      `Код действует до ${expiresLabel}.`,
      'Если вы не запрашивали смену пароля, проигнорируйте письмо и проверьте безопасность аккаунта.',
      'После входа рекомендуем установить новый уникальный пароль.',
    ].join('\n'),
  };
}

function buildHtmlTemplate(input: {
  preheader: string;
  title: string;
  greeting: string;
  paragraphs: string[];
  code: string;
  note: string;
}) {
  const paragraphs = input.paragraphs
    .map(
      (paragraph) =>
        `<p style="margin:0 0 14px;color:#243342;font-size:15px;line-height:1.6;">${paragraph}</p>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="ru">
  <body style="margin:0;padding:24px;background:#eef3f6;font-family:Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${input.preheader}</div>
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:20px;padding:32px 28px;border:1px solid #d6e0e7;">
      <div style="margin-bottom:24px;">
        <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:#10263f;color:#ffffff;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Эра Спорта</div>
      </div>
      <h1 style="margin:0 0 16px;color:#10263f;font-size:28px;line-height:1.2;">${input.title}</h1>
      <p style="margin:0 0 18px;color:#243342;font-size:15px;line-height:1.6;">${input.greeting}</p>
      ${paragraphs}
      <div style="margin:24px 0;padding:18px 20px;border-radius:16px;background:#f3f7fa;border:1px solid #d6e0e7;text-align:center;">
        <div style="margin-bottom:8px;color:#587088;font-size:13px;text-transform:uppercase;letter-spacing:0.08em;">Код подтверждения</div>
        <div style="color:#10263f;font-size:34px;line-height:1;font-weight:700;letter-spacing:0.3em;">${input.code}</div>
      </div>
      <p style="margin:0;color:#587088;font-size:13px;line-height:1.6;">${input.note}</p>
    </div>
  </body>
</html>`;
}

function formatExpiryLabel(expiresAt: Date) {
  return new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
  }).format(expiresAt);
}

function parseBoolean(value: string) {
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}
