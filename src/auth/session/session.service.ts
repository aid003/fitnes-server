import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisStore } from 'connect-redis';
import session, { MemoryStore, type SessionOptions } from 'express-session';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { createClient } from 'redis';

@Injectable()
export class SessionService implements OnModuleDestroy {
  private readonly redisClient?: ReturnType<typeof createClient>;
  private readonly middleware: ReturnType<typeof session>;
  private readonly cookieName = 'sid';

  constructor(
    configService: ConfigService,
    @InjectPinoLogger(SessionService.name)
    private readonly logger: PinoLogger,
  ) {
    const sessionSecret =
      configService.get<string>('SESSION_SECRET') ?? 'dev-session-secret';
    const redisUrl = this.resolveRedisUrl(configService);
    const isProduction = configService.get<string>('NODE_ENV') === 'production';

    const baseOptions: SessionOptions = {
      name: this.cookieName,
      secret: sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: isProduction,
        maxAge: 1000 * 60 * 60 * 24 * 7,
      },
    };

    if (redisUrl) {
      const redisClient = createClient({
        url: redisUrl,
      });

      redisClient.on('error', (error: Error) => {
        this.logger.warn({ err: error }, 'Redis session store error');
      });

      void redisClient.connect().catch((error: unknown) => {
        this.logger.warn(
          { err: error },
          'Unable to connect to Redis. Session store will retry on demand.',
        );
      });

      this.redisClient = redisClient;
      this.middleware = session({
        ...baseOptions,
        store: new RedisStore({
          client: redisClient,
          prefix: 'fitnes-server:sess:',
        }),
      });

      return;
    }

    this.logger.warn(
      'REDIS_URL is not configured. Falling back to in-memory session store.',
    );

    this.middleware = session({
      ...baseOptions,
      store: new MemoryStore(),
    });
  }

  getMiddleware(): ReturnType<typeof session> {
    return this.middleware;
  }

  getCookieName(): string {
    return this.cookieName;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redisClient?.isOpen) {
      await this.redisClient.quit();
    }
  }

  private resolveRedisUrl(configService: ConfigService): string | undefined {
    const directUrl = configService.get<string>('REDIS_URL');

    if (directUrl) {
      return directUrl;
    }

    const host = configService.get<string>('REDIS_HOST');
    const port = configService.get<string>('REDIS_PORT');
    const password = configService.get<string>('REDIS_PASSWORD');

    if (!host || !port) {
      return undefined;
    }

    const credentials = password
      ? `:${encodeURIComponent(password)}@`
      : '';

    return `redis://${credentials}${host}:${port}`;
  }
}
