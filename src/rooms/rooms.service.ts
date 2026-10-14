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

function parseDmKey(key: string): [string, string] | null {
  const parts = key.split("_");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }
  return [parts[0], parts[1]];
}

const LINK = /https?:\/\/[^\s<>"']+/gi;

@Injectable()
export class RoomsService {
  constructor(private readonly prisma: PrismaService) {}

  private directRoomHasPair(
    members: { userId: string }[],
    a: string,
    b: string,
  ): boolean {
    if (members.length !== 2) {
      return false;
    }
    const ids = new Set(members.map((m) => m.userId));
    return ids.has(a) && ids.has(b);
  }

  /** DM bị thêm nhầm thành viên → giữ đúng 2 user theo dmKey. */
  private async repairDirectRoomMembers(
    roomId: string,
    dmKey: string | null,
  ): Promise<void> {
    const pair = dmKey ? parseDmKey(dmKey) : null;
    if (!pair) {
      return;
    }
    await this.prisma.roomMember.deleteMany({
      where: {
        roomId,
        userId: { notIn: pair },
      },
    });
  }

  /** Tên hiển thị: ưu tiên tên tài khoản, nickname phòng chỉ là fallback. */
  memberDisplayName(member: {
    nickname: string;
    user: { name: string };
  }): string {
    const account = member.user.name?.trim() ?? "";
    if (account) {
      return account;
    }
    return member.nickname?.trim() ?? "";
  }

  private lastMessagePreview(message: {
    content: string;
    recalledAt: Date | null;
    imageId: string | null;
    fileId: string | null;
  }): string {
    if (message.recalledAt) {
      return "Tin nhắn đã được thu hồi";
    }
    if (message.imageId) {
      return "Hình ảnh";
    }
    if (message.fileId) {
      return "Tệp đính kèm";
    }
    const text = message.content.trim();
    if (text.length <= 120) {
      return text;
    }
    return `${text.slice(0, 120)}…`;
  }
  // DM: chỉ phòng đã có tin. Nhóm: thành viên là đủ (kể cả chưa có tin).
  async listForUser(
    userId: string,
    _team?: string,
    opts: { limit?: number; cursor?: string } = {},
  ) {
    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
    const cursorMs = opts.cursor ? Date.parse(opts.cursor) : Number.NaN;

    const rooms = await this.prisma.room.findMany({
      where: {
        members: { some: { userId } },
        OR: [
          { kind: RoomKind.group },
          {
            messages: {
              some: {
                hides: { none: { userId } },
              },
            },
          },
        ],
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
            fileId: true,
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

    const sorted = items.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

    const afterCursor =
      !Number.isNaN(cursorMs) && opts.cursor
        ? sorted.filter(
            (item) => new Date(item.updatedAt).getTime() < cursorMs,
          )
        : sorted;

    const page = afterCursor.slice(0, limit);
    const hasMore = afterCursor.length > limit;
    const nextCursor = hasMore ? page[page.length - 1]?.updatedAt ?? null : null;

    return {
      data: page,
      meta: {
        hasMore,
        nextCursor,
      },
    };
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
        fileId: string | null;
        createdAt: Date;
      }[];
    },
    viewerId: string,
    unreadCount = 0,
  ) {
    const last = room.messages[0];
    const updatedAt = last?.createdAt ?? room.createdAt;
    const isDirect = room.kind === RoomKind.direct;

    let title = room.name.trim();
    let peerUserId: string | null = null;
    if (isDirect) {
      const peer = room.members.find((m) => m.userId !== viewerId);
      peerUserId = peer?.userId ?? null;
      title = peer ? this.memberDisplayName(peer) : "Chat cá nhân";
      if (!title) {
        title = "Chat cá nhân";
      }
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
      peerUserId,
    };
  }

  async getMemberRoom(roomId: string, userId: string, _team?: string) {
    const member = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
      include: {
        room: {
          include: {
            members: { select: { userId: true } },
          },
        },
      },
    });
    if (!member) {
      throw new NotFoundException("Room not found");
    }
    const room = member.room;
    if (room.kind === RoomKind.direct) {
      const count = room.members.length;
      if (count !== 2) {
        await this.repairDirectRoomMembers(room.id, room.dmKey);
        const fixed = await this.prisma.roomMember.count({ where: { roomId } });
        if (fixed !== 2) {
          throw new BadRequestException(
            "Phòng chat cá nhân không hợp lệ. Hãy tạo cuộc trò chuyện mới.",
          );
        }
      }
    }
    return room;
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
          select: {
            id: true,
            name: true,
            email: true,
            team: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { user: { name: "asc" } },
    });
    return members.map((item) => ({
      id: item.user.id,
      name: item.user.name,
      email: item.user.email,
      team: item.user.team,
      nickname: item.nickname || "",
      displayName: this.memberDisplayName(item),
      handle: item.user.email.split("@")[0],
      avatarUrl: item.user.avatarUrl || "",
    }));
  }

  async displayName(roomId: string, userId: string, fallback: string) {
    const member = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
      select: { nickname: true, user: { select: { name: true } } },
    });
    if (member) {
      const label = this.memberDisplayName(member);
      if (label) {
        return label;
      }
    }
    return fallback.trim() || "Unknown";
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
    const key = buildDmKey(actorId, targetId);
    const directInclude = {
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
        orderBy: { createdAt: "desc" as const },
        take: 1,
        select: {
          content: true,
          recalledAt: true,
          imageId: true,
          fileId: true,
          createdAt: true,
        },
      },
    };

    let existing = await this.prisma.room.findUnique({
      where: { dmKey: key },
      include: directInclude,
    });

    if (
      existing &&
      !this.directRoomHasPair(existing.members, actorId, targetId)
    ) {
      await this.repairDirectRoomMembers(existing.id, existing.dmKey);
      existing = await this.prisma.room.findUnique({
        where: { id: existing.id },
        include: directInclude,
      });
      if (
        !existing ||
        !this.directRoomHasPair(existing.members, actorId, targetId)
      ) {
        const brokenId = existing?.id;
        if (brokenId) {
          await this.prisma.room.update({
            where: { id: brokenId },
            data: { dmKey: null },
          });
        }
        existing = null;
      }
    }

    if (!existing) {
      const legacy = await this.prisma.room.findMany({
        where: {
          kind: RoomKind.direct,
          AND: [
            { members: { some: { userId: actorId } } },
            { members: { some: { userId: targetId } } },
          ],
        },
        include: directInclude,
      });
      existing =
        legacy.find((room) =>
          this.directRoomHasPair(room.members, actorId, targetId),
        ) ?? null;
      if (existing && !existing.dmKey) {
        await this.prisma.room.update({
          where: { id: existing.id },
          data: { dmKey: key },
        });
      }
    }

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
