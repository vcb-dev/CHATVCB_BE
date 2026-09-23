import { Injectable } from '@nestjs/common';
import { AgentClientService } from '../agent/agent.client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RoomsService } from '../rooms/rooms.service.js';
import { ChatEvents } from './chat.events.js';

const AGENT_MENTION = /@agent\b/i;

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsService,
    private readonly events: ChatEvents,
    private readonly agent: AgentClientService,
  ) {}

  async list(roomId: string, userId: string) {
    await this.rooms.getMemberRoom(roomId, userId);
    return this.prisma.message.findMany({
      where: { roomId },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
  }

  async createFromUser(roomId: string, userId: string, name: string, content: string) {
    const room = await this.rooms.getMemberRoom(roomId, userId);
    const message = await this.prisma.message.create({
      data: {
        roomId,
        userId,
        authorName: name,
        role: 'user',
        content: content.trim(),
      },
    });

    this.events.emitToRoom(roomId, 'message', message);

    if (this.shouldInvokeAgent(content, room.agentName)) {
      this.events.emitToRoom(roomId, 'agent.pending', {
        roomId,
        agentName: room.agentName,
      });
      const history = await this.prisma.message.findMany({
        where: { roomId },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
      void this.replyWithAgent({
        roomId,
        messageId: message.id,
        userId,
        userName: name,
        agentName: room.agentName,
        content: message.content,
        history: history.reverse().map((item) => ({
          role: item.role,
          authorName: item.authorName,
          content: item.content,
        })),
      });
    }

    return message;
  }

  async createFromAgent(roomId: string, content: string, agentName = 'Agent') {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    const message = await this.prisma.message.create({
      data: {
        roomId,
        authorName: room?.agentName ?? agentName,
        role: 'agent',
        content,
      },
    });
    this.events.emitToRoom(roomId, 'message', message);
    return message;
  }

  private async replyWithAgent(job: {
    roomId: string;
    messageId: string;
    userId: string;
    userName: string;
    agentName: string;
    content: string;
    history: { role: string; authorName: string; content: string }[];
  }) {
    try {
      const content = await this.agent.invoke(job);
      await this.createFromAgent(job.roomId, content, job.agentName);
    } catch (error) {
      await this.createFromAgent(
        job.roomId,
        `Không gọi được AI: ${error instanceof Error ? error.message : 'unknown'}`,
        job.agentName,
      );
    }
  }

  private shouldInvokeAgent(content: string, agentName: string) {
    if (AGENT_MENTION.test(content)) {
      return true;
    }
    const named = new RegExp(`@${agentName}\\b`, 'i');
    return named.test(content);
  }
}
