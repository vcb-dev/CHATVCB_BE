import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { teamForAgent } from './agent-brains.js';
import type { CreateKnowledgeDto } from './dto/create-knowledge.dto.js';

@Injectable()
export class KnowledgeService {
  constructor(private readonly prisma: PrismaService) {}

  assertTeam(agentName: string, userTeam: string) {
    const team = teamForAgent(agentName);
    if (!team) {
      throw new NotFoundException('Agent không tồn tại');
    }
    if (team !== userTeam) {
      throw new ForbiddenException('Bạn không được sửa não agent team khác');
    }
    return team;
  }

  list(agentName: string, userTeam: string) {
    const team = this.assertTeam(agentName, userTeam);
    return this.prisma.agentKnowledge.findMany({
      where: { agentName, team },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  listForInvoke(agentName: string) {
    return this.prisma.agentKnowledge.findMany({
      where: { agentName },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: { title: true, content: true },
    });
  }

  create(agentName: string, userTeam: string, dto: CreateKnowledgeDto) {
    const team = this.assertTeam(agentName, userTeam);
    return this.prisma.agentKnowledge.create({
      data: {
        agentName,
        team,
        title: dto.title.trim(),
        content: dto.content.trim(),
      },
    });
  }

  async remove(id: string, userTeam: string) {
    const item = await this.prisma.agentKnowledge.findUnique({ where: { id } });
    if (!item) {
      throw new NotFoundException('Không thấy mẩu kiến thức');
    }
    this.assertTeam(item.agentName, userTeam);
    await this.prisma.agentKnowledge.delete({ where: { id } });
    return { ok: true };
  }
}
