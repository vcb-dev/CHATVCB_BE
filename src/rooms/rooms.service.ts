import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

@Injectable()
export class RoomsService {
  constructor(private readonly prisma: PrismaService) {}

  async listForUser(userId: string, team?: string) {
    const userTeam =
      team ||
      (
        await this.prisma.user.findUnique({
          where: { id: userId },
          select: { team: true },
        })
      )?.team;
    if (!userTeam) {
      return [];
    }
    return this.prisma.room.findMany({
      where: {
        team: userTeam,
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

  async getMemberRoom(roomId: string, userId: string, team?: string) {
    const member = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
      include: { room: true },
    });
    if (!member) {
      throw new NotFoundException('Room not found');
    }
    const userTeam =
      team ||
      (
        await this.prisma.user.findUnique({
          where: { id: userId },
          select: { team: true },
        })
      )?.team;
    if (!userTeam || member.room.team !== userTeam) {
      throw new ForbiddenException('Bạn không thuộc team của phòng này');
    }
    return member.room;
  }
}
