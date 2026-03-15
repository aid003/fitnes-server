import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { setupApp } from './setup-app';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const logger = app.get(Logger);
  app.useLogger(logger);

  const { jsonPath, uiPath } = setupApp(app);
  const port = Number(process.env.PORT ?? 3000);

  await app.listen(port);

  const baseUrl = `http://localhost:${port}`;
  logger.log(`OpenAPI UI: ${baseUrl}/${uiPath}`, 'Bootstrap');
  logger.log(`OpenAPI JSON: ${baseUrl}/${jsonPath}`, 'Bootstrap');
  logger.log(`🚀 Server ready | Port ${port}`, 'Bootstrap');
}
void bootstrap();
