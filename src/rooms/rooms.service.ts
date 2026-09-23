import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class RoomsService {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      return [];
    }
    return this.prisma.room.findMany({
      where: {
        team: user.team,
        members: { some: { userId } },
      },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        slug: true,
        name: true,
        team: true,
        agentName: true,
      },
    });
  }

  async getMemberRoom(roomId: string, userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Room not found');
    }
    const member = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
      include: { room: true },
    });
    if (!member) {
      throw new NotFoundException('Room not found');
    }
    if (member.room.team !== user.team) {
      throw new ForbiddenException('Bạn không thuộc team của phòng này');
    }
    return member.room;
  }
}
