import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

function meetingCode() {
  return String(Math.floor(100000000 + Math.random() * 900000000));
}

@Injectable()
export class MeetingsService {
  private readonly live = new Set<string>();

  constructor(private readonly prisma: PrismaService) {}

  touchLive(id: string) {
    this.live.add(id);
  }

  dropLive(id: string) {
    this.live.delete(id);
  }

  async create(userId: string, team: string, title?: string, scheduledAt?: string) {
    const when = scheduledAt ? new Date(scheduledAt) : null;
    const instant = !when || when.getTime() <= Date.now();
    const name = title?.trim() || (instant ? `Họp ${team}` : 'Cuộc họp đã lên lịch');
    for (let i = 0; i < 6; i += 1) {
      try {
        const meeting = await this.prisma.meeting.create({
          data: {
            code: meetingCode(),
            title: name,
            team,
            hostId: userId,
            scheduledAt: when,
            startedAt: instant ? new Date() : null,
            participants: { create: { userId } },
          },
          include: this.include(),
        });
        return this.present(meeting);
      } catch {
        // retry unique code
      }
    }
    throw new Error('Không tạo được mã họp.');
  }

  async join(userId: string, team: string, code: string) {
    const meeting = await this.prisma.meeting.findUnique({
      where: { code: code.replace(/\s+/g, '') },
      include: this.include(),
    });
    if (!meeting) {
      throw new NotFoundException('Không tìm thấy cuộc họp.');
    }
    if (meeting.team !== team) {
      throw new ForbiddenException('Cuộc họp thuộc team khác.');
    }
    if (meeting.endedAt) {
      throw new ForbiddenException('Cuộc họp đã kết thúc.');
    }
    await this.prisma.meetingParticipant.upsert({
      where: { meetingId_userId: { meetingId: meeting.id, userId } },
      create: { meetingId: meeting.id, userId },
      update: { leftAt: null, joinedAt: new Date() },
    });
    if (!meeting.startedAt) {
      await this.prisma.meeting.update({
        where: { id: meeting.id },
        data: { startedAt: new Date() },
      });
    }
    return this.getForTeam(meeting.id, team);
  }

  async getForTeam(id: string, team: string) {
    const meeting = await this.prisma.meeting.findUnique({
      where: { id },
      include: this.include(),
    });
    if (!meeting || meeting.team !== team) {
      throw new NotFoundException('Không tìm thấy cuộc họp.');
    }
    return this.present(meeting);
  }

  async list(team: string) {
    const items = await this.prisma.meeting.findMany({
      where: { team },
      include: this.include(),
      orderBy: { createdAt: 'desc' },
      take: 80,
    });
    const now = Date.now();
    const upcoming = [];
    const history = [];
    for (const item of items) {
      const startedAt = item.startedAt;
      const stale =
        !item.endedAt &&
        startedAt &&
        !this.live.has(item.id) &&
        now - startedAt.getTime() > 15_000;
      if (stale) {
        await this.endIfEmpty(item.id);
        history.push(this.present({ ...item, endedAt: new Date() }));
        continue;
      }
      const row = this.present(item);
      const upcomingItem =
        !item.endedAt &&
        (!item.startedAt
          ? !item.scheduledAt || item.scheduledAt.getTime() >= now - 60 * 60 * 1000
          : this.live.has(item.id));
      if (upcomingItem) {
        upcoming.push(row);
      } else {
        history.push(row);
      }
    }
    upcoming.sort((a, b) => {
      const aTime = new Date(a.scheduledAt || a.startedAt || a.createdAt).getTime();
      const bTime = new Date(b.scheduledAt || b.startedAt || b.createdAt).getTime();
      return aTime - bTime;
    });
    return { upcoming, history };
  }

  async saveNotes(id: string, userId: string, team: string, notes: string) {
    await this.getForTeam(id, team);
    const meeting = await this.prisma.meeting.update({
      where: { id },
      data: { notes },
      include: this.include(),
    });
    if (meeting.hostId !== userId && meeting.team !== team) {
      throw new ForbiddenException();
    }
    return this.present(meeting);
  }

  async leave(id: string, userId: string, team: string) {
    const meeting = await this.getForTeam(id, team);
    await this.prisma.meetingParticipant.updateMany({
      where: { meetingId: id, userId, leftAt: null },
      data: { leftAt: new Date() },
    });
    return meeting;
  }

  async end(id: string, userId: string, team: string) {
    const meeting = await this.prisma.meeting.findUnique({ where: { id } });
    if (!meeting || meeting.team !== team) {
      throw new NotFoundException('Không tìm thấy cuộc họp.');
    }
    if (meeting.hostId !== userId) {
      return this.leave(id, userId, team);
    }
    const updated = await this.prisma.meeting.update({
      where: { id },
      data: { endedAt: new Date() },
      include: this.include(),
    });
    return this.present(updated);
  }

  async endIfEmpty(id: string) {
    const meeting = await this.prisma.meeting.findUnique({ where: { id } });
    if (!meeting || meeting.endedAt) {
      return;
    }
    await this.prisma.meeting.update({
      where: { id },
      data: { endedAt: new Date() },
    });
  }

  private include() {
    return {
      host: { select: { id: true, name: true, avatarUrl: true } },
      participants: {
        include: { user: { select: { id: true, name: true, avatarUrl: true } } },
        orderBy: { joinedAt: 'asc' as const },
      },
    };
  }

  private present(meeting: {
    id: string;
    code: string;
    title: string;
    team: string;
    hostId: string;
    notes: string;
    scheduledAt: Date | null;
    startedAt: Date | null;
    endedAt: Date | null;
    createdAt: Date;
    host: { id: string; name: string; avatarUrl: string };
    participants: { user: { id: string; name: string; avatarUrl: string } }[];
  }) {
    return {
      id: meeting.id,
      code: meeting.code,
      title: meeting.title,
      team: meeting.team,
      hostId: meeting.hostId,
      hostName: meeting.host.name,
      notes: meeting.notes,
      scheduledAt: meeting.scheduledAt,
      startedAt: meeting.startedAt,
      endedAt: meeting.endedAt,
      createdAt: meeting.createdAt,
      participants: meeting.participants.map((item) => item.user),
    };
  }
}
