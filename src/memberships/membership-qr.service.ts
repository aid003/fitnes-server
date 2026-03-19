import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as QRCode from 'qrcode';
import { createHmac, timingSafeEqual } from 'node:crypto';

const MEMBERSHIP_QR_VERSION = 'membership-qr.v1';

export type MembershipQrPayload = {
  membershipId: string;
  user: {
    id: string;
    name: string;
    email: string;
  };
  membership: {
    title: string;
    subtitle: string | null;
    status: string;
    startsAt: string;
    endsAt: string;
    freezeDaysLimit: number;
  };
  plan: {
    id: string;
    title: string;
    subtitle: string | null;
    description: string | null;
    categoryTitle?: string | null;
    variantTitle?: string | null;
    groupTitle?: string | null;
    billingType: string | null;
    durationValue: number | null;
    durationUnit: string | null;
  };
  payment: {
    paymentId: string;
    merchantOrderNumber: string;
    gatewayOrderId: string | null;
    status: string;
    amount: number;
    currency: string;
    createdAt: string;
    paidAt: string | null;
    membershipIssuedAt: string | null;
    actionCode: number | null;
    actionCodeDescription: string | null;
  };
  generatedAt: string;
};

type MembershipQrEnvelope = {
  version: string;
  payload: MembershipQrPayload;
  signature: string;
};

@Injectable()
export class MembershipQrService {
  constructor(private readonly configService: ConfigService) {}

  async createEnvelope(payload: MembershipQrPayload) {
    const signature = this.signPayload(payload);
    const content = JSON.stringify({
      version: MEMBERSHIP_QR_VERSION,
      payload,
      signature,
    });
    const qrCodeSvg = await QRCode.toString(content, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 1,
      color: {
        dark: '#1a1320',
        light: '#ffffff',
      },
    });

    return {
      signature,
      qrCodeSvg,
      content,
    };
  }

  parseAndVerify(rawContent: string) {
    const trimmedContent = rawContent.trim();
    let parsedContent: unknown;

    try {
      parsedContent = JSON.parse(trimmedContent) as unknown;
    } catch {
      throw new BadRequestException(
        'QR-код повреждён: не удалось прочитать JSON.',
      );
    }

    const parsedEnvelope = parsedContent as Partial<MembershipQrEnvelope>;

    if (
      !parsedEnvelope ||
      typeof parsedEnvelope !== 'object' ||
      parsedEnvelope.version !== MEMBERSHIP_QR_VERSION ||
      !parsedEnvelope.payload ||
      typeof parsedEnvelope.signature !== 'string'
    ) {
      throw new BadRequestException('QR-код имеет неподдерживаемый формат.');
    }

    const expectedSignature = this.signPayload(parsedEnvelope.payload);
    const actualBuffer = Buffer.from(parsedEnvelope.signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (
      actualBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(actualBuffer, expectedBuffer)
    ) {
      throw new BadRequestException('Подпись QR-кода недействительна.');
    }

    return parsedEnvelope as MembershipQrEnvelope;
  }

  getVersion() {
    return MEMBERSHIP_QR_VERSION;
  }

  private signPayload(payload: MembershipQrPayload) {
    const secret = this.configService.get<string>('MEMBERSHIP_QR_SECRET');

    if (!secret) {
      throw new InternalServerErrorException(
        'MEMBERSHIP_QR_SECRET is not configured',
      );
    }

    return createHmac('sha256', secret)
      .update(stableStringify(payload))
      .digest('hex');
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`);

    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value);
}
