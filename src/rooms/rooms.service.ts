import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { RoomKind } from "@prisma/client";
import { randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service.js";

function buildDmKey(a: string, b: string): string {
  return [a, b].sort().join("_");
}

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
  // Lấy danh sách phòng chat cho người dùng
  async listForUser(userId: string, _team?: string) {
    const rooms = await this.prisma.room.findMany({
      where: {
        members: { some: { userId } },
      },
      select: {
        id: true,
        slug: true,
        name: true,
        kind: true,
        createdById: true,
        team: true,
        agentName: true,
        avatarUrl: true,
        createdAt: true,
        members: {
          select: {
            userId: true,
            nickname: true,
            lastReadMessageId: true,
            lastReadAt: true,
            user: { select: { id: true, name: true } },
          },
        },
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

    const items = await Promise.all(
      rooms.map(async (room) => {
        const viewerMember = room.members.find((m) => m.userId === userId);
        const unreadCount = await this.unreadCountForRoom(
          room.id,
          userId,
          viewerMember?.lastReadAt ?? null,
        );
        return this.toConversationItem(room, userId, unreadCount);
      }),
    );

    return items.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }

  private async unreadCountForRoom(
    roomId: string,
    viewerId: string,
    lastReadAt: Date | null,
  ): Promise<number> {
    return this.prisma.message.count({
      where: {
        roomId,
        userId: { not: viewerId },
        recalledAt: null,
        hides: { none: { userId: viewerId } },
        ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
      },
    });
  }
  // Chuyển đổi phòng chat thành đối tượng trao đổi
  private toConversationItem(
    room: {
      id: string;
      name: string;
      kind: RoomKind;
      createdById: string | null;
      avatarUrl: string;
      createdAt: Date;
      members: {
        userId: string;
        nickname: string;
        lastReadMessageId: string | null;
        lastReadAt: Date | null;
        user: { id: string; name: string };
      }[];
      messages: {
        content: string;
        recalledAt: Date | null;
        imageId: string | null;
        createdAt: Date;
      }[];
    },
    viewerId: string,
    unreadCount = 0,
  ) {
    const last = room.messages[0];
    const updatedAt = last?.createdAt ?? room.createdAt;
    const isDirect = room.kind === RoomKind.direct;

    let title = room.name;
    if (isDirect) {
      const peer = room.members.find((m) => m.userId !== viewerId);
      title = peer?.nickname || peer?.user.name || "Chat cá nhân";
    }

    const type = isDirect ? "direct" : "group";

    return {
      id: room.id,
      title,
      name: room.name,
      type,
      kind: room.kind,
      avatarUrl: room.avatarUrl || "",
      lastMessagePreview: last ? this.lastMessagePreview(last) : "",
      updatedAt: updatedAt.toISOString(),
      canDelete: room.kind === RoomKind.group && room.createdById === viewerId,
      createdById: room.createdById,
      unreadCount,
    };
  }

  async getMemberRoom(roomId: string, userId: string, _team?: string) {
    const member = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
      include: { room: true },
    });
    if (!member) {
      throw new NotFoundException("Room not found");
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
  // Tìm hoặc tạo phòng chat cá nhân
  async findOrCreateDirect(actorId: string, targetId: string) {
    if (actorId === targetId) {
      throw new BadRequestException("Không thể chat với chính mình.");
    }
    // Tìm người dùng đích
    const target = await this.prisma.user.findFirst({
      where: { id: targetId, isActive: true },
      select: { id: true },
    });
    if (!target) {
      throw new NotFoundException("Không tìm thấy người dùng.");
    }
    // Tạo key phòng chat cá nhân
    const key = buildDmKey(actorId, targetId);
    // Tìm phòng chat cá nhân
    const existing = await this.prisma.room.findUnique({
      where: { dmKey: key },
      include: {
        members: {
          select: {
            userId: true,
            nickname: true,
            lastReadMessageId: true,
            lastReadAt: true,
            user: { select: { id: true, name: true } },
          },
        },
        messages: {
          where: { hides: { none: { userId: actorId } } },
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
    // Nếu phòng chat cá nhân tồn tại, trả về đối tượng trao đổi
    if (existing) {
      const viewerMember = existing.members.find((m) => m.userId === actorId);
      const unreadCount = await this.unreadCountForRoom(
        existing.id,
        actorId,
        viewerMember?.lastReadAt ?? null,
      );
      return this.toConversationItem(
        {
          ...existing,
          kind: existing.kind,
          createdById: existing.createdById,
          createdAt: existing.createdAt,
          avatarUrl: existing.avatarUrl,
          name: existing.name,
        },
        actorId,
        unreadCount,
      );
    }

    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { team: true },
    });

    // Tạo phòng chat cá nhân
    const room = await this.prisma.$transaction(async (tx) => {
      const created = await tx.room.create({
        data: {
          slug: `dm-${randomUUID()}`,
          name: "",
          kind: RoomKind.direct,
          dmKey: key,
          team: actor?.team ?? "sale",
          agentName: "",
          members: {
            create: [{ userId: actorId }, { userId: targetId }],
          },
        },
      });
      return created;
    });

    return this.toConversationItem(
      {
        id: room.id,
        name: room.name,
        kind: room.kind,
        createdById: room.createdById,
        avatarUrl: room.avatarUrl,
        createdAt: room.createdAt,
        members: await this.prisma.roomMember.findMany({
          where: { roomId: room.id },
          select: {
            userId: true,
            nickname: true,
            lastReadMessageId: true,
            lastReadAt: true,
            user: { select: { id: true, name: true } },
          },
        }),
        messages: [],
      },
      actorId,
      0,
    );
  }
  // Tạo nhóm chat
  async createGroup(actorId: string, name: string, memberIds: string[]) {
    const trimmed = name.trim();
    if (!trimmed) {
      throw new BadRequestException("Tên nhóm không được trống.");
    }

    const uniqueIds = [...new Set(memberIds.filter((id) => id !== actorId))];
    if (uniqueIds.length === 0) {
      throw new BadRequestException("Cần ít nhất một thành viên khác.");
    }

    const users = await this.prisma.user.findMany({
      where: { id: { in: uniqueIds }, isActive: true },
      select: { id: true },
    });
    if (users.length !== uniqueIds.length) {
      throw new BadRequestException("Một số thành viên không hợp lệ.");
    }

    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { team: true },
    });

    const room = await this.prisma.room.create({
      data: {
        slug: `group-${randomUUID()}`,
        name: trimmed,
        kind: RoomKind.group,
        createdById: actorId,
        team: actor?.team ?? "sale",
        agentName: "",
        members: {
          create: [
            { userId: actorId },
            ...uniqueIds.map((userId) => ({ userId })),
          ],
        },
      },
    });
    // Trả về đối tượng trao đổi
    return this.toConversationItem(
      {
        id: room.id,
        name: room.name,
        kind: room.kind,
        createdById: room.createdById,
        avatarUrl: room.avatarUrl,
        createdAt: room.createdAt,
        members: await this.prisma.roomMember.findMany({
          where: { roomId: room.id },
          select: {
            userId: true,
            nickname: true,
            lastReadMessageId: true,
            lastReadAt: true,
            user: { select: { id: true, name: true } },
          },
        }),
        messages: [],
      },
      actorId,
      0,
    );
  }
  // Xóa nhóm chat
  async deleteGroup(roomId: string, actorId: string) {
    // Lấy phòng chat
    const room = await this.getMemberRoom(roomId, actorId);
    // Nếu phòng chat không phải là nhóm, throw lỗi
    if (room.kind !== RoomKind.group) {
      throw new BadRequestException("Chỉ xóa được nhóm chat.");
    }
    if (room.createdById !== actorId) {
      throw new ForbiddenException("Chỉ người tạo nhóm mới được xóa.");
    }
    await this.prisma.room.delete({ where: { id: roomId } });
  }
}
