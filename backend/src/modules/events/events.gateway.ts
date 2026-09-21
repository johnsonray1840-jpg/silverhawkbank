import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

@WebSocketGateway({
  cors: {
    origin: '*',
  },
  namespace: '/realtime',
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);
  private userSocketMap = new Map<string, Set<string>>();

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  /**
   * Handle WebSocket handshake and JWT authentication
   */
  async handleConnection(client: Socket) {
    try {
      const authHeader = client.handshake.headers.authorization;
      const token = authHeader?.startsWith('Bearer ')
        ? authHeader.slice(7)
        : (client.handshake.query?.token as string);

      if (!token) {
        this.logger.warn(`Unauthenticated socket connection rejected: ${client.id}`);
        client.disconnect();
        return;
      }

      const secret = this.configService.get<string>('JWT_ACCESS_SECRET') || 'silverhawk-super-secret-jwt-key';
      const payload = await this.jwtService.verifyAsync(token, { secret });
      const userId = payload.sub || payload.id;

      if (!userId) {
        client.disconnect();
        return;
      }

      client.data.userId = userId;
      client.data.role = payload.role;

      // Join user-specific private room
      client.join(`user:${userId}`);

      // If user is ADMIN or STAFF, join administrative monitoring room
      if (payload.role === 'ADMIN' || payload.role === 'SUPER_ADMIN' || payload.role === 'COMPLIANCE_OFFICER') {
        client.join('room:admin');
      }

      // Track connection
      if (!this.userSocketMap.has(userId)) {
        this.userSocketMap.set(userId, new Set());
      }
      this.userSocketMap.get(userId)!.add(client.id);

      this.logger.log(`Client connected: [socketId: ${client.id}, userId: ${userId}]`);
      client.emit('connected', { message: 'Authenticated with Silverhawk Realtime Engine', userId });
    } catch (err: any) {
      this.logger.warn(`Socket auth error: ${err.message}`);
      client.disconnect();
    }
  }

  /**
   * Handle client disconnect
   */
  handleDisconnect(client: Socket) {
    const userId = client.data?.userId;
    if (userId && this.userSocketMap.has(userId)) {
      this.userSocketMap.get(userId)!.delete(client.id);
      if (this.userSocketMap.get(userId)!.size === 0) {
        this.userSocketMap.delete(userId);
      }
    }
    this.logger.log(`Client disconnected: ${client.id}`);
  }

  /**
   * Push real-time balance update to a specific customer's active tabs
   */
  emitBalanceUpdate(userId: string, data: { accountId: string; availableBalance: string; currentBalance: string; currency: string }) {
    this.server.to(`user:${userId}`).emit('balance.updated', data);
  }

  /**
   * Push instant transaction notification to a customer
   */
  emitTransactionCreated(userId: string, data: any) {
    this.server.to(`user:${userId}`).emit('transaction.created', data);
  }

  /**
   * Push in-app alert notification
   */
  emitNotification(userId: string, data: any) {
    this.server.to(`user:${userId}`).emit('notification.received', data);
  }

  /**
   * Broadcast live activity to staff / admin compliance room
   */
  emitAdminLiveFeed(data: any) {
    this.server.to('room:admin').emit('admin.live_feed', data);
  }

  /**
   * Ping / Pong heartbeat listener
   */
  @SubscribeMessage('ping')
  handlePing(client: Socket) {
    return { event: 'pong', data: { timestamp: Date.now() } };
  }
}

