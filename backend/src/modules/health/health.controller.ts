import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../database/prisma.service';
import { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import * as os from 'os';

@ApiTags('System Health & Telemetry')
@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'System health check and live operational telemetry' })
  @ApiResponse({ status: 200, description: 'Service operational, database connected, memory metrics' })
  async checkHealth(@Res({ passthrough: true }) res: Response) {
    const startTime = Date.now();

    // 1. Database Liveness Probe
    let dbStatus = 'UP';
    let dbLatencyMs = 0;
    try {
      const dbStart = Date.now();
      await this.prisma.$queryRawUnsafe('SELECT 1');
      dbLatencyMs = Date.now() - dbStart;
    } catch (err: any) {
      dbStatus = 'DOWN';
    }

    const isHealthy = dbStatus === 'UP';
    if (!isHealthy) {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    const memoryUsage = process.memoryUsage();

    return {
      status: isHealthy ? 'HEALTHY' : 'DEGRADED',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      version: '1.0.0',
      environment: process.env.NODE_ENV || 'production',
      services: {
        database: {
          engine: 'MySQL 8.0 (InnoDB)',
          status: dbStatus,
          latencyMs: dbLatencyMs,
        },
      },
      system: {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        cpus: os.cpus().length,
        freeMemoryMb: Math.round(os.freemem() / (1024 * 1024)),
        totalMemoryMb: Math.round(os.totalmem() / (1024 * 1024)),
        processMemory: {
          rssMb: Math.round(memoryUsage.rss / (1024 * 1024)),
          heapTotalMb: Math.round(memoryUsage.heapTotal / (1024 * 1024)),
          heapUsedMb: Math.round(memoryUsage.heapUsed / (1024 * 1024)),
        },
      },
      responseTimeMs: Date.now() - startTime,
    };
  }
}
