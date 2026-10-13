import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service.js";

const LINK = /https?:\/\/[^\s<>"']+/gi;

@Injectable()
export class RoomsService {
  constructor(private readonly prisma: PrismaService) {}

  private lastMessagePreview(message: {
    content: string;
    recalledAt: Date | null;
    imageId: string | null;
  }): string {
    if (message.recalledAt) {
      return "Tin nhắn đã được thu hồi";
    }
    if (message.imageId) {
      return "Hình ảnh";
    }
    const text = message.content.trim();
    if (text.length <= 120) {
      return text;
    }
    return `${text.slice(0, 120)}…`;
  }

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
    const rooms = await this.prisma.room.findMany({
      where: {
        team: userTeam,
        members: { some: { userId } },
      },
      select: {
        id: true,
        slug: true,
        name: true,
        team: true,
        agentName: true,
        avatarUrl: true,
        createdAt: true,
        messages: {
          where: { hides: { none: { userId } } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: {
            content: true,
            recalledAt: true,
            imageId: true,
            createdAt: true,
          },
        },
      },
    });

    return rooms
      .map((room) => {
        const last = room.messages[0];
        const updatedAt = last?.createdAt ?? room.createdAt;
        return {
          id: room.id,
          slug: room.slug,
          name: room.name,
          title: room.name,
          team: room.team,
          agentName: room.agentName,
          avatarUrl: room.avatarUrl || "",
          type: "group",
          lastMessagePreview: last ? this.lastMessagePreview(last) : "",
          updatedAt: updatedAt.toISOString(),
        };
      })
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
  }

  async getMemberRoom(roomId: string, userId: string, team?: string) {
    const member = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
      include: { room: true },
    });
    if (!member) {
      throw new NotFoundException("Room not found");
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
      throw new ForbiddenException("Bạn không thuộc team của phòng này");
    }
    return member.room;
  }

  toPublicRoom(room: {
    id: string;
    slug: string;
    name: string;
    team: string;
    agentName: string;
    avatarUrl?: string | null;
  }) {
    return {
      id: room.id,
      slug: room.slug,
      name: room.name,
      team: room.team,
      agentName: room.agentName,
      avatarUrl: room.avatarUrl || "",
    };
  }

  async listMembers(roomId: string, userId: string, team?: string) {
    await this.getMemberRoom(roomId, userId, team);
    const members = await this.prisma.roomMember.findMany({
      where: { roomId },
      select: {
        nickname: true,
        user: {
          select: { id: true, name: true, email: true, avatarUrl: true },
        },
      },
      orderBy: { user: { name: "asc" } },
    });
    return members.map((item) => ({
      id: item.user.id,
      name: item.user.name,
      nickname: item.nickname || "",
      displayName: item.nickname || item.user.name,
      handle: item.user.email.split("@")[0],
      avatarUrl: item.user.avatarUrl || "",
    }));
  }

  async displayName(roomId: string, userId: string, fallback: string) {
    const member = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
      select: { nickname: true, user: { select: { name: true } } },
    });
    return member?.nickname || member?.user.name || fallback;
  }

  async updateName(
    roomId: string,
    userId: string,
    name: string,
    team?: string,
  ) {
    await this.getMemberRoom(roomId, userId, team);
    const trimmed = name.trim();
    if (!trimmed) {
      throw new BadRequestException("Tên nhóm không được trống.");
    }
    const room = await this.prisma.room.update({
      where: { id: roomId },
      data: { name: trimmed },
    });
    return this.toPublicRoom(room);
  }

  async updateAvatar(
    roomId: string,
    userId: string,
    url: string,
    team?: string,
  ) {
    await this.getMemberRoom(roomId, userId, team);
    const room = await this.prisma.room.update({
      where: { id: roomId },
      data: { avatarUrl: url },
    });
    return this.toPublicRoom(room);
  }

  async updateNickname(
    roomId: string,
    actorId: string,
    targetId: string,
    nickname: string,
    team?: string,
  ) {
    await this.getMemberRoom(roomId, actorId, team);
    const member = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: targetId } },
    });
    if (!member) {
      throw new NotFoundException("Không tìm thấy thành viên.");
    }
    await this.prisma.roomMember.update({
      where: { roomId_userId: { roomId, userId: targetId } },
      data: { nickname: nickname.trim() },
    });
    return this.listMembers(roomId, actorId, team);
  }

  async listLinks(roomId: string, userId: string, team?: string) {
    await this.getMemberRoom(roomId, userId, team);
    const rows = await this.prisma.message.findMany({
      where: {
        roomId,
        recalledAt: null,
        hides: { none: { userId } },
        content: { contains: "http" },
      },
      orderBy: { createdAt: "desc" },
      take: 80,
      select: {
        id: true,
        content: true,
        authorName: true,
        createdAt: true,
      },
    });
    const links: {
      url: string;
      messageId: string;
      authorName: string;
      createdAt: Date;
    }[] = [];
    for (const row of rows) {
      const found = row.content.match(LINK) ?? [];
      for (const url of found) {
        links.push({
          url,
          messageId: row.id,
          authorName: row.authorName,
          createdAt: row.createdAt,
        });
      }
    }
    return links.slice(0, 80);
  }
}
