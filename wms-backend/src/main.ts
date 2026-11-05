import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { jwtRefreshSecret, jwtSecret } from './common/secrets';

async function bootstrap() {
  // Fail fast with a clear message before any DI wiring or port binding.
  jwtSecret();
  jwtRefreshSecret();

  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api/v1');

  // Allowed browser origins. The API binds to localhost by default (see below),
  // so these only matter when the frontend is served from a different origin.
  // EXTRA_CORS_ORIGINS (comma-separated) extends the list for non-local deployments.
  const corsOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];
  if (process.env.EXTRA_CORS_ORIGINS) {
    corsOrigins.push(
      ...process.env.EXTRA_CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    );
  }
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('WMS Backend API')
    .setDescription('WMS 后端接口文档')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();

  const doc = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, doc);

  // Bind to loopback unless explicitly told otherwise. Nest's default is every
  // interface, which on a publicly-addressed host exposes the API (and the
  // commercial rate cards behind it) to the network. Serving other machines is a
  // deliberate act: set HOST=0.0.0.0 and put TLS/authz at the edge.
  const host = process.env.HOST ?? '127.0.0.1';
  await app.listen(Number(process.env.PORT ?? 3001), host);
  console.log(`WMS API listening on http://${host}:${process.env.PORT ?? 3001}/api/v1`);
}

void bootstrap();