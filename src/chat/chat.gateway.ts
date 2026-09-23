import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { corsOrigins } from '../cors-origins.js';
import type { JwtPayload } from '../auth/jwt-payload.js';
import { RoomsService } from '../rooms/rooms.service.js';
import { ChatEvents } from './chat.events.js';

@WebSocketGateway({
  cors: {
    origin: corsOrigins(),
    credentials: true,
  },
})
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private readonly events: ChatEvents,
    private readonly jwt: JwtService,
    private readonly rooms: RoomsService,
  ) {}

  afterInit(server: Server) {
    this.events.server = server;
  }

  handleConnection(client: Socket) {
    const token = this.readToken(client);
    if (!token) {
      client.disconnect();
      return;
    }

    try {
      const payload = this.jwt.verify<JwtPayload>(token);
      client.data.user = payload;
    } catch {
      this.logger.warn(`Socket ${client.id} rejected`);
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    const roomId = client.data.roomId as string | undefined;
    if (roomId) {
      this.emitPresence(roomId);
    }
  }

  @SubscribeMessage('join')
  async handleJoin(client: Socket, roomId: string) {
    const user = client.data.user as JwtPayload | undefined;
    if (!user || typeof roomId !== 'string') {
      return;
    }
    try {
      await this.rooms.getMemberRoom(roomId, user.sub, user.team);
    } catch {
      return;
    }
    for (const joined of client.rooms) {
      if (joined.startsWith('room:')) {
        void client.leave(joined);
      }
    }
    client.data.roomId = roomId;
    void client.join(`room:${roomId}`);
    this.emitPresence(roomId);
  }

  private emitPresence(roomId: string) {
    const room = this.server.sockets.adapter.rooms.get(`room:${roomId}`);
    const seen = new Map<string, { id: string; name: string }>();
    if (room) {
      for (const socketId of room) {
        const socket = this.server.sockets.sockets.get(socketId);
        const user = socket?.data?.user as JwtPayload | undefined;
        if (user?.sub) {
          seen.set(user.sub, { id: user.sub, name: user.name });
        }
      }
    }
    this.events.emitToRoom(roomId, 'room.presence', [...seen.values()]);
  }

  private readToken(client: Socket): string | null {
    const authToken = client.handshake.auth?.token;
    if (typeof authToken === 'string' && authToken.length > 0) {
      return authToken;
    }
    const header = client.handshake.headers.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      return header.slice(7);
    }
    return null;
  }
}
