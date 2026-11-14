import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { JsonLogger } from './infrastructure/logger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);
  app.useLogger(app.get(JsonLogger));
  app.enableShutdownHooks();

  if (config.get<string>('SWAGGER_ENABLED') === 'true') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('AutoServiceManager Execution')
      .setDescription('Worker assíncrono de diagnóstico e execução')
      .setVersion('1.0')
      .build();
    SwaggerModule.setup(
      'docs',
      app,
      SwaggerModule.createDocument(app, swaggerConfig),
    );
  }

  await app.listen(config.get<number>('PORT', 3000), '0.0.0.0');
}

void bootstrap();
