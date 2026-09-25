import { Injectable } from '@nestjs/common';
import { AgentClientService } from '../agent/agent.client.js';
import { KnowledgeService } from '../agent/knowledge.service.js';
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
    private readonly knowledge: KnowledgeService,
  ) {}

  async list(roomId: string, userId: string, team?: string) {
    await this.rooms.getMemberRoom(roomId, userId, team);
    const rows = await this.prisma.message.findMany({
      where: { roomId },
      orderBy: { createdAt: 'desc' },
      take: 80,
      select: {
        id: true,
        roomId: true,
        userId: true,
        authorName: true,
        role: true,
        content: true,
        createdAt: true,
      },
    });
    return rows.reverse();
  }

  async createFromUser(
    roomId: string,
    userId: string,
    name: string,
    content: string,
    team?: string,
  ) {
    const room = await this.rooms.getMemberRoom(roomId, userId, team);
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
      const [history, knowledge] = await Promise.all([
        this.prisma.message.findMany({
          where: { roomId },
          orderBy: { createdAt: 'desc' },
          take: 12,
          select: {
            role: true,
            authorName: true,
            content: true,
          },
        }),
        this.knowledge.listForInvoke(room.agentName),
      ]);
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
        knowledge,
      });
    }

    return message;
  }

  async createFromAgent(roomId: string, content: string, agentName = 'Agent') {
    const message = await this.prisma.message.create({
      data: {
        roomId,
        authorName: agentName,
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
    knowledge: { title: string; content: string }[];
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
