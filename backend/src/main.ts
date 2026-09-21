import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import * as express from 'express';
import * as path from 'path';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // OWASP-Aligned Security Headers Middleware
  app.use((req: any, res: any, next: any) => {
    // 1. Prevent MIME-type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // 2. Clickjacking & Frame embedding protection
    res.setHeader('X-Frame-Options', 'DENY');

    // 3. Cross-Site Scripting (XSS) Legacy Filter Guard
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // 4. HTTP Strict Transport Security (HSTS) - 1 Year with preloading
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');

    // 5. Referrer Policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // 6. Content Security Policy (CSP) - Compatible with Tailwind, Alpine.js, and FontAwesome CDNs
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self' https: data: 'unsafe-inline' 'unsafe-eval'; img-src 'self' data: https: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://unpkg.com https://cdnjs.cloudflare.com https://kit.fontawesome.com https://ka-p.fontawesome.com https://cdn.socket.io; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://ka-p.fontawesome.com https://cdn.tailwindcss.com; font-src 'self' https://fonts.gstatic.com https://ka-p.fontawesome.com https://cdnjs.cloudflare.com data:; connect-src 'self' wss: ws: https:; frame-ancestors 'none'; object-src 'none';",
    );

    // 7. Permissions Policy (Hardware / Sensor lockdown)
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)');

    // 8. Cross-Origin Opener / Resource Policies
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    next();
  });

  // Strict CORS configuration
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:3001',
        'http://localhost:5500',
        'http://127.0.0.1:5500',
        ...(process.env.APP_URL ? [process.env.APP_URL] : []),
        ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL] : []),
      ];

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server) or matching allowed list
      if (!origin || allowedOrigins.includes(origin) || process.env.NODE_ENV !== 'production') {
        callback(null, true);
      } else {
        callback(new Error('CORS request blocked by security policy'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Idempotency-Key',
      'X-Idempotency-Key',
      'X-Requested-With',
      'stripe-signature',
      'x-paystack-signature',
      'verif-hash',
    ],
  });

  // Global Prefix for API endpoints
  app.setGlobalPrefix('api/v1');

  // Serve static frontend assets (index.html, dashboard.html, admin.html, temp/, images/, etc.)
  const possibleRoots = [
    path.resolve(__dirname, '../../../'),
    path.resolve(__dirname, '../../'),
    path.resolve(process.cwd(), '../'),
    process.cwd(),
  ];
  const frontendDir = possibleRoots.find((dir) => {
    try {
      return require('fs').existsSync(path.join(dir, 'admin.html'));
    } catch {
      return false;
    }
  }) || path.resolve(__dirname, '../../');

  console.log(`📂 Serving static frontend assets from: ${frontendDir}`);
  const cleanRouteMap: Record<string, string> = {
    '/admin': 'admin.html',
    '/dashboard': 'dashboard.html',
    '/login': 'login.html',
    '/register': 'register.html',
    '/verify': 'verify.html',
    '/forgot-password': 'forgot-password.html',
    '/about': 'about.html',
    '/contact': 'contact.html',
    '/privacy': 'privacy.html',
    '/terms': 'terms-of-service.html',
    '/terms-of-service': 'terms-of-service.html',
    '/grants': 'grants.html',
    '/send-money': 'send-money.html',
    '/alerts': 'alerts.html',
    '/apps': 'apps.html',
    '/chart': 'chart.html',
  };

  app.use((req: any, res: any, next: any) => {
    if (req.path && req.path.startsWith('/api/')) return next();
    const cleanPath = (req.path || '').replace(/\/$/, '').toLowerCase();
    if (cleanRouteMap[cleanPath]) {
      const targetFile = path.join(frontendDir, cleanRouteMap[cleanPath]);
      if (require('fs').existsSync(targetFile)) {
        return res.sendFile(targetFile);
      }
    }
    next();
  });
  app.use(express.static(frontendDir, { index: 'index.html' }));

  // Global Validation Pipe with strict DTO stripping
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // OpenAPI / Swagger Documentation
  const config = new DocumentBuilder()
    .setTitle('Silverhawk Digital Banking Platform API')
    .setDescription('Production-grade RESTful API documentation for Silverhawk Digital Banking Platform')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`🚀 Silverhawk Banking Platform Unified Core running on: http://localhost:${port}`);
  console.log(`📚 REST API Engine: http://localhost:${port}/api/v1`);
  console.log(`📚 Swagger Documentation: http://localhost:${port}/api/docs`);
  console.log(`🌐 Customer Banking Portal: http://localhost:${port}/dashboard`);
  console.log(`🛡️  Executive Admin Console: http://localhost:${port}/admin`);
}

bootstrap();
