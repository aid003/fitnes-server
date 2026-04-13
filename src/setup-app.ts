import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import express from 'express';
import { LoggerErrorInterceptor } from 'nestjs-pino';
import { SessionService } from './auth/session/session.service';
import { ensureUploadsDirectory, uploadsRoot } from './common/uploads/upload.utils';

export type AppDocsConfig = {
  jsonPath: string;
  uiPath: string;
};

export function setupApp(app: INestApplication): AppDocsConfig {
  const uiPath = 'api';
  const jsonPath = 'api-json';
  const configService = app.get(ConfigService);
  const frontendOrigin =
    configService.get<string>('FRONTEND_ORIGIN') ?? 'http://localhost:3000';
  const appBaseUrl =
    configService.get<string>('APP_BASE_URL') ?? frontendOrigin;

  if (appBaseUrl.startsWith('https://')) {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }

  app.useGlobalInterceptors(new LoggerErrorInterceptor());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.use(app.get(SessionService).getMiddleware());
  void ensureUploadsDirectory();
  app.use('/uploads', express.static(uploadsRoot));
  app.enableCors({
    origin: frontendOrigin,
    credentials: true,
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Fitnes Server API')
    .setDescription('Development OpenAPI documentation for Fitnes Server')
    .setVersion('1.0.0')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);

  SwaggerModule.setup(uiPath, app, document, {
    jsonDocumentUrl: jsonPath,
  });

  return {
    jsonPath,
    uiPath,
  };
}
