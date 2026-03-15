import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { setupApp } from '../src/setup-app';

describe('AppController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    process.env.DATABASE_URL =
      process.env.DATABASE_URL ??
      'postgresql://postgres:postgres@localhost:5432/postgres';
    delete process.env.REDIS_URL;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    setupApp(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('registers the development routes', () => {
    const expressApp = app.getHttpAdapter().getInstance() as {
      router?: {
        stack?: Array<{
          route?: {
            path?: string;
          };
        }>;
      };
    };

    const registeredPaths =
      expressApp.router?.stack
        ?.map((layer) => layer.route?.path)
        .filter((path): path is string => Boolean(path)) ?? [];

    expect(registeredPaths).toContain('/');
    expect(registeredPaths).toContain('/api');
    expect(registeredPaths).toContain('/api-json');
  });
});
