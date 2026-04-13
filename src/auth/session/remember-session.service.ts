import { Injectable } from '@nestjs/common';
import type { Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { SessionService } from './session.service';

type RememberSessionRecord = {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
};

@Injectable()
export class RememberSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
  ) {}

  async issue(userId: string, response: Response): Promise<void> {
    const token = randomBytes(32).toString('base64url');

    await this.prisma.rememberSession.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + this.sessionService.getRememberMaxAgeMs()),
      },
    });

    this.sessionService.setRememberCookie(response, token);
  }

  async rotate(rawToken: string, response: Response): Promise<RememberSessionRecord | null> {
    const current = await this.prisma.rememberSession.findUnique({
      where: {
        tokenHash: hashToken(rawToken),
      },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        revokedAt: true,
      },
    });

    if (!isSessionUsable(current)) {
      return null;
    }

    const nextToken = randomBytes(32).toString('base64url');

    await this.prisma.$transaction([
      this.prisma.rememberSession.update({
        where: { id: current.id },
        data: {
          revokedAt: new Date(),
          lastUsedAt: new Date(),
        },
      }),
      this.prisma.rememberSession.create({
        data: {
          userId: current.userId,
          tokenHash: hashToken(nextToken),
          expiresAt: new Date(Date.now() + this.sessionService.getRememberMaxAgeMs()),
          lastUsedAt: new Date(),
        },
      }),
      this.prisma.rememberSession.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: new Date() } },
            { revokedAt: { not: null } },
          ],
        },
      }),
    ]);

    this.sessionService.setRememberCookie(response, nextToken);

    return current;
  }

  async revokeByToken(rawToken: string | undefined): Promise<void> {
    if (!rawToken) {
      return;
    }

    await this.prisma.rememberSession.updateMany({
      where: {
        tokenHash: hashToken(rawToken),
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.rememberSession.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function isSessionUsable(session: RememberSessionRecord | null): session is RememberSessionRecord {
  return Boolean(
    session &&
      !session.revokedAt &&
      session.expiresAt.getTime() > Date.now(),
  );
}
