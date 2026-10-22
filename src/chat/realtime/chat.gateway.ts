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
import { corsOriginDelegate } from '../../cors-origins.js';
import type { JwtPayload } from '../../auth/jwt-payload.js';
import { MeetingsService } from '../../meetings/meetings.service.js';
import { RoomsService } from '../../rooms/rooms.service.js';
import { ChatEvents } from './chat.events.js';

@WebSocketGateway({
  cors: {
    origin: corsOriginDelegate,
    credentials: true,
  },
})
export class ChatGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);
  private readonly meetingChats = new Map<string, { id: string; userId: string; name: string; text: string; at: number }[]>();
  private readonly meetingHands = new Map<string, { userId: string; name: string }[]>();
  private readonly emptyTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly events: ChatEvents,
    private readonly jwt: JwtService,
    private readonly rooms: RoomsService,
    private readonly meetings: MeetingsService,
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
      this.broadcastOnline();
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
    this.leaveMeeting(client);
    this.broadcastOnline();
  }

  @SubscribeMessage('presence.get')
  handlePresenceGet(client: Socket) {
    client.emit('presence.online', this.onlineUsers());
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
    // Cho phép join nhiều phòng (inbox realtime) — không leave phòng cũ.
    client.data.roomId = roomId;
    void client.join(`room:${roomId}`);
    this.emitPresence(roomId);
  }

  @SubscribeMessage('meeting.join')
  async handleMeetingJoin(client: Socket, meetingId: string) {
    const user = client.data.user as JwtPayload | undefined;
    if (!user || typeof meetingId !== 'string') {
      return;
    }
    try {
      await this.meetings.getForTeam(meetingId, user.team);
    } catch {
      return;
    }
    if (client.data.meetingId && client.data.meetingId !== meetingId) {
      this.leaveMeeting(client);
    }
    const pending = this.emptyTimers.get(meetingId);
    if (pending) {
      clearTimeout(pending);
      this.emptyTimers.delete(meetingId);
    }
    this.meetings.touchLive(meetingId);
    client.data.meetingId = meetingId;
    void client.join(`meeting:${meetingId}`);
    const self = { socketId: client.id, userId: user.sub, name: user.name };
    const peers = this.meetingPeers(meetingId).filter((item) => item.socketId !== client.id);
    client.emit('meeting.peers', peers);
    client.to(`meeting:${meetingId}`).emit('meeting.peer-joined', self);
    client.emit('meeting.chat-history', this.meetingChats.get(meetingId) ?? []);
    client.emit('meeting.hands', this.meetingHands.get(meetingId) ?? []);
  }

  @SubscribeMessage('meeting.chat')
  handleMeetingChat(client: Socket, body: { text?: string }) {
    const meetingId = client.data.meetingId as string | undefined;
    const user = client.data.user as JwtPayload | undefined;
    const text = body?.text?.trim();
    if (!meetingId || !user || !text) {
      return;
    }
    const item = { id: `${Date.now()}-${client.id}`, userId: user.sub, name: user.name, text, at: Date.now() };
    const list = this.meetingChats.get(meetingId) ?? [];
    list.push(item);
    this.meetingChats.set(meetingId, list.slice(-80));
    this.server.to(`meeting:${meetingId}`).emit('meeting.chat', item);
  }

  @SubscribeMessage('meeting.react')
  handleMeetingReact(client: Socket, body: { emoji?: string }) {
    const meetingId = client.data.meetingId as string | undefined;
    const user = client.data.user as JwtPayload | undefined;
    if (!meetingId || !user || !body?.emoji) {
      return;
    }
    this.server.to(`meeting:${meetingId}`).emit('meeting.react', {
      id: `${Date.now()}-${client.id}`,
      userId: user.sub,
      name: user.name,
      emoji: body.emoji,
    });
  }

  @SubscribeMessage('meeting.hand')
  handleMeetingHand(client: Socket, body: { raised?: boolean }) {
    const meetingId = client.data.meetingId as string | undefined;
    const user = client.data.user as JwtPayload | undefined;
    if (!meetingId || !user) {
      return;
    }
    const raised = Boolean(body?.raised);
    const current = this.meetingHands.get(meetingId) ?? [];
    const next = raised
      ? [...current.filter((item) => item.userId !== user.sub), { userId: user.sub, name: user.name }]
      : current.filter((item) => item.userId !== user.sub);
    this.meetingHands.set(meetingId, next);
    this.server.to(`meeting:${meetingId}`).emit('meeting.hands', next);
  }

  @SubscribeMessage('meeting.signal')
  handleMeetingSignal(client: Socket, body: { to?: string; payload?: unknown }) {
    if (!body?.to) {
      return;
    }
    const user = client.data.user as JwtPayload | undefined;
    this.server.to(body.to).emit('meeting.signal', {
      from: client.id,
      userId: user?.sub,
      name: user?.name,
      payload: body.payload,
    });
  }

  @SubscribeMessage('meeting.leave')
  handleMeetingLeave(client: Socket) {
    this.leaveMeeting(client);
  }

  private leaveMeeting(client: Socket) {
    const meetingId = client.data.meetingId as string | undefined;
    if (!meetingId) {
      return;
    }
    const user = client.data.user as JwtPayload | undefined;
    void client.leave(`meeting:${meetingId}`);
    client.to(`meeting:${meetingId}`).emit('meeting.peer-left', { socketId: client.id });
    client.data.meetingId = undefined;
    if (user?.sub) {
      const hands = (this.meetingHands.get(meetingId) ?? []).filter((item) => item.userId !== user.sub);
      this.meetingHands.set(meetingId, hands);
      this.server.to(`meeting:${meetingId}`).emit('meeting.hands', hands);
      void this.meetings.leave(meetingId, user.sub, user.team).catch(() => undefined);
    }
    if (this.meetingPeers(meetingId).length === 0) {
      this.meetingChats.delete(meetingId);
      this.meetingHands.delete(meetingId);
      this.meetings.dropLive(meetingId);
      const pending = this.emptyTimers.get(meetingId);
      if (pending) {
        clearTimeout(pending);
      }
      this.emptyTimers.set(
        meetingId,
        setTimeout(() => {
          this.emptyTimers.delete(meetingId);
          if (this.meetingPeers(meetingId).length === 0) {
            void this.meetings.endIfEmpty(meetingId);
          }
        }, 2500),
      );
    }
  }

  private meetingPeers(meetingId: string) {
    const room = this.server.sockets.adapter.rooms.get(`meeting:${meetingId}`);
    const peers: { socketId: string; userId: string; name: string }[] = [];
    if (!room) {
      return peers;
    }
    for (const socketId of room) {
      const socket = this.server.sockets.sockets.get(socketId);
      const user = socket?.data?.user as JwtPayload | undefined;
      if (user?.sub) {
        peers.push({ socketId, userId: user.sub, name: user.name });
      }
    }
    return peers;
  }

  // Mọi người đang kết nối (mỗi user một lần, dù mở nhiều tab).
  private onlineUsers() {
    const seen = new Map<string, { id: string; name: string; handle: string }>();
    for (const socket of this.server.sockets.sockets.values()) {
      const user = socket.data.user as JwtPayload | undefined;
      if (user) {
        const handle = user.email?.split('@')[0] ?? '';
        seen.set(user.sub, { id: user.sub, name: user.name, handle });
      }
    }
    return [...seen.values()];
  }

  private broadcastOnline() {
    this.server.emit('presence.online', this.onlineUsers());
  }

  private emitPresence(roomId: string) {
    const room = this.server.sockets.adapter.rooms.get(`room:${roomId}`);
    const seen = new Map<string, { id: string; name: string; handle: string }>();
    if (room) {
      for (const socketId of room) {
        const socket = this.server.sockets.sockets.get(socketId);
        const user = socket?.data?.user as JwtPayload | undefined;
        if (user?.sub) {
          const handle = user.email?.split('@')[0] ?? '';
          seen.set(user.sub, { id: user.sub, name: user.name, handle });
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
