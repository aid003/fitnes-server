import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { LoggerErrorInterceptor } from 'nestjs-pino';
import { SessionService } from './auth/session/session.service';

export type AppDocsConfig = {
  jsonPath: string;
  uiPath: string;
};

export function setupApp(app: INestApplication): AppDocsConfig {
  const uiPath = 'api';
  const jsonPath = 'api-json';

  app.useGlobalInterceptors(new LoggerErrorInterceptor());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.use(app.get(SessionService).getMiddleware());

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
