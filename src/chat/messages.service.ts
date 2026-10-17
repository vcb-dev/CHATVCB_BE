import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AgentClientService } from "../agent/agent.client.js";
import { KnowledgeService } from "../agent/knowledge.service.js";
import { PrismaService } from "../prisma/prisma.service.js";
import { RoomsService } from "../rooms/rooms.service.js";
import { AttachmentsService } from "./attachments.service.js";
import { ChatEvents } from "./chat.events.js";
import { REACTION_EMOJIS } from "./dto/react-message.dto.js";
import { ImagesService } from "./images.service.js";
import { imageUrl } from "./upload-dir.js";

const AGENT_MENTION = /@agent\b/i;

type MessageRow = {
  id: string;
  roomId: string;
  userId: string | null;
  authorName: string;
  role: string;
  content: string;
  imageId: string | null;
  fileId: string | null;
  replyToId?: string | null;
  pinnedAt?: Date | null;
  recalledAt?: Date | null;
  createdAt: Date;
  image?: { url: string } | null;
  file?: {
    url: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
  } | null;
  replyTo?: {
    id: string;
    userId: string | null;
    authorName: string;
    content: string;
    recalledAt: Date | null;
    image: { url: string } | null;
  } | null;
  user?: { avatarUrl: string } | null;
  reactions?: {
    emoji: string;
    userId: string;
    user?: { name: string; avatarUrl: string } | null;
  }[];
};

const MESSAGE_SELECT = {
  id: true,
  roomId: true,
  userId: true,
  authorName: true,
  role: true,
  content: true,
  imageId: true,
  fileId: true,
  replyToId: true,
  pinnedAt: true,
  recalledAt: true,
  createdAt: true,
  image: { select: { url: true } },
  file: {
    select: {
      url: true,
      filename: true,
      mimeType: true,
      sizeBytes: true,
    },
  },
  replyTo: {
    select: {
      id: true,
      userId: true,
      authorName: true,
      content: true,
      recalledAt: true,
      image: { select: { url: true } },
    },
  },
  user: { select: { avatarUrl: true } },
  reactions: {
    select: {
      emoji: true,
      userId: true,
      user: { select: { name: true, avatarUrl: true } },
    },
  },
} as const;

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsService,
    private readonly events: ChatEvents,
    private readonly agent: AgentClientService,
    private readonly knowledge: KnowledgeService,
    private readonly images: ImagesService,
    private readonly attachments: AttachmentsService,
  ) {}

  async list(
    roomId: string,
    userId: string,
    team?: string,
    opts: { limit?: number; cursor?: string } = {},
  ) {
    await this.rooms.getMemberRoom(roomId, userId, team);

    const limit = Math.min(Math.max(opts.limit ?? 80, 1), 100);
    const cursorMs = opts.cursor ? Date.parse(opts.cursor) : Number.NaN;
    const hasCursor = !Number.isNaN(cursorMs) && Boolean(opts.cursor);

    const rows = await this.prisma.message.findMany({
      where: {
        roomId,
        hides: { none: { userId } },
        ...(hasCursor ? { createdAt: { lt: new Date(cursorMs) } } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit + 1,
      select: MESSAGE_SELECT,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore
      ? (page[page.length - 1]?.createdAt ?? null)
      : null;
    const names = await this.displayNames(roomId);

    return {
      data: [...page].reverse().map((row) => this.toPublic(row, names)),
      meta: { hasMore, nextCursor },
    };
  }

  async listPinned(roomId: string, userId: string, team?: string) {
    await this.rooms.getMemberRoom(roomId, userId, team);
    const rows = await this.prisma.message.findMany({
      where: {
        roomId,
        pinnedAt: { not: null },
        recalledAt: null,
        hides: { none: { userId } },
      },
      orderBy: { pinnedAt: "desc" },
      take: 40,
      select: MESSAGE_SELECT,
    });
    const names = await this.displayNames(roomId);
    return rows.map((row) => this.toPublic(row, names));
  }

  async createFromUser(
    roomId: string,
    userId: string,
    name: string,
    content: string,
    team?: string,
    imageId?: string,
    replyToId?: string,
    fileId?: string,
  ) {
    const text = content.trim();
    if (!text && !imageId && !fileId) {
      throw new BadRequestException("Tin nhắn trống.");
    }
    const room = await this.rooms.getMemberRoom(roomId, userId, team);
    if (imageId) {
      await this.images.assertInRoom(imageId, roomId);
    }
    if (fileId) {
      await this.attachments.assertInRoom(fileId, roomId);
    }
    if (replyToId) {
      const parent = await this.prisma.message.findFirst({
        where: { id: replyToId, roomId },
        select: { id: true },
      });
      if (!parent) {
        throw new BadRequestException("Không tìm thấy tin nhắn để trả lời.");
      }
    }
    const authorName = await this.rooms.displayName(roomId, userId, name);
    const message = await this.prisma.message.create({
      data: {
        roomId,
        userId,
        authorName,
        role: "user",
        content: text,
        imageId: imageId || null,
        fileId: fileId || null,
        replyToId: replyToId || null,
      },
      select: MESSAGE_SELECT,
    });

    const names = await this.displayNames(roomId);
    const payload = this.toPublic(message, names);
    this.events.emitToRoom(roomId, "message", payload);

    if (this.shouldInvokeAgent(text, room.agentName)) {
      this.events.emitToRoom(roomId, "agent.pending", {
        roomId,
        agentName: room.agentName,
      });
      const [history, knowledge] = await Promise.all([
        this.prisma.message.findMany({
          where: { roomId, recalledAt: null },
          orderBy: { createdAt: "desc" },
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
        userName: authorName,
        agentName: room.agentName,
        content: text || "[ảnh]",
        history: history.reverse().map((item) => ({
          role: item.role,
          authorName: item.authorName,
          content: item.content,
        })),
        knowledge,
      });
    }

    return payload;
  }

  async createFromAgent(roomId: string, content: string, agentName = "Agent") {
    const message = await this.prisma.message.create({
      data: {
        roomId,
        authorName: agentName,
        role: "agent",
        content,
      },
      select: MESSAGE_SELECT,
    });
    const names = await this.displayNames(roomId);
    const payload = this.toPublic(message, names);
    this.events.emitToRoom(roomId, "message", payload);
    return payload;
  }

  async pin(
    roomId: string,
    userId: string,
    messageId: string,
    pinned: boolean,
    team?: string,
  ) {
    await this.rooms.getMemberRoom(roomId, userId, team);
    const existing = await this.prisma.message.findFirst({
      where: { id: messageId, roomId },
      select: { id: true, recalledAt: true },
    });
    if (!existing || existing.recalledAt) {
      throw new NotFoundException("Không tìm thấy tin nhắn.");
    }
    const message = await this.prisma.message.update({
      where: { id: messageId },
      data: { pinnedAt: pinned ? new Date() : null },
      select: MESSAGE_SELECT,
    });
    const names = await this.displayNames(roomId);
    const payload = this.toPublic(message, names);
    this.events.emitToRoom(roomId, "message.updated", payload);
    return payload;
  }
  /**
   * Thêm hoặc xóa reaction cho tin nhắn
   */
  async react(
    roomId: string,
    userId: string,
    messageId: string,
    emoji: string,
    team?: string,
  ) {
    await this.rooms.getMemberRoom(roomId, userId, team);
    if (!(REACTION_EMOJIS as readonly string[]).includes(emoji)) {
      throw new BadRequestException("Emoji không hợp lệ.");
    }
    const existing = await this.prisma.message.findFirst({
      where: { id: messageId, roomId },
      select: { id: true, recalledAt: true },
    });
    if (!existing || existing.recalledAt) {
      throw new NotFoundException("Không tìm thấy tin nhắn.");
    }
    const current = await this.prisma.messageReaction.findUnique({
      where: { messageId_userId: { messageId, userId } },
      select: { emoji: true },
    });
    if (current?.emoji === emoji) {
      await this.prisma.messageReaction.delete({
        where: { messageId_userId: { messageId, userId } },
      });
    } else if (current) {
      await this.prisma.messageReaction.update({
        where: { messageId_userId: { messageId, userId } },
        data: { emoji },
      });
    } else {
      await this.prisma.messageReaction.create({
        data: { messageId, userId, emoji },
      });
    }
    const message = await this.prisma.message.findFirstOrThrow({
      where: { id: messageId },
      select: MESSAGE_SELECT,
    });
    const names = await this.displayNames(roomId);
    const payload = this.toPublic(message, names);
    this.events.emitToRoom(roomId, "message.updated", payload);
    return payload;
  }

  async recall(
    roomId: string,
    userId: string,
    messageId: string,
    team?: string,
  ) {
    await this.rooms.getMemberRoom(roomId, userId, team);
    const existing = await this.prisma.message.findFirst({
      where: { id: messageId, roomId },
    });
    if (!existing) {
      throw new NotFoundException("Không tìm thấy tin nhắn.");
    }
    if (existing.userId !== userId) {
      throw new ForbiddenException("Chỉ thu hồi được tin của bạn.");
    }
    const message = await this.prisma.message.update({
      where: { id: messageId },
      data: {
        recalledAt: new Date(),
        content: "",
        imageId: null,
        pinnedAt: null,
      },
      select: MESSAGE_SELECT,
    });
    const names = await this.displayNames(roomId);
    const payload = this.toPublic(message, names);
    this.events.emitToRoom(roomId, "message.updated", payload);
    return payload;
  }

  async hide(roomId: string, userId: string, messageId: string, team?: string) {
    await this.rooms.getMemberRoom(roomId, userId, team);
    const existing = await this.prisma.message.findFirst({
      where: { id: messageId, roomId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException("Không tìm thấy tin nhắn.");
    }
    await this.prisma.messageHide.upsert({
      where: { messageId_userId: { messageId, userId } },
      update: {},
      create: { messageId, userId },
    });
    return { ok: true, id: messageId };
  }

  async listReads(roomId: string, userId: string, team?: string) {
    await this.rooms.getMemberRoom(roomId, userId, team);
    return this.loadReads(roomId);
  }

  async markRead(
    roomId: string,
    userId: string,
    messageId: string,
    team?: string,
  ) {
    await this.rooms.getMemberRoom(roomId, userId, team);
    const message = await this.prisma.message.findFirst({
      where: { id: messageId, roomId },
      select: { id: true, createdAt: true },
    });
    if (!message) {
      throw new NotFoundException("Không tìm thấy tin nhắn.");
    }
    const member = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
      select: { lastReadMessageId: true, lastReadAt: true },
    });
    if (member?.lastReadMessageId && member.lastReadMessageId !== messageId) {
      const current = await this.prisma.message.findFirst({
        where: { id: member.lastReadMessageId, roomId },
        select: { createdAt: true },
      });
      if (current && current.createdAt > message.createdAt) {
        const reads = await this.loadReads(roomId);
        this.events.emitToRoom(roomId, "room.reads", { roomId, reads });
        return reads;
      }
    }
    if (member?.lastReadMessageId !== messageId) {
      await this.prisma.roomMember.update({
        where: { roomId_userId: { roomId, userId } },
        data: {
          lastReadMessageId: message.id,
          lastReadAt: new Date(),
        },
      });
    }
    const reads = await this.loadReads(roomId);
    this.events.emitToRoom(roomId, "room.reads", { roomId, reads });
    return reads;
  }

  private async displayNames(roomId: string) {
    const members = await this.prisma.roomMember.findMany({
      where: { roomId },
      select: {
        userId: true,
        nickname: true,
        user: { select: { name: true } },
      },
    });
    return new Map(
      members.map((item) => [item.userId, this.rooms.memberDisplayName(item)]),
    );
  }

  private async loadReads(roomId: string) {
    const rows = await this.prisma.roomMember.findMany({
      where: { roomId, lastReadMessageId: { not: null } },
      select: {
        lastReadMessageId: true,
        lastReadAt: true,
        nickname: true,
        user: { select: { id: true, name: true, avatarUrl: true } },
      },
    });
    return rows.map((item) => ({
      userId: item.user.id,
      name: this.rooms.memberDisplayName(item),
      avatarUrl: item.user.avatarUrl ?? "",
      lastReadMessageId: item.lastReadMessageId,
      lastReadAt: item.lastReadAt,
    }));
  }

  private toPublic(message: MessageRow, names?: Map<string, string>) {
    const recalled = Boolean(message.recalledAt);
    const authorName =
      (message.userId && names?.get(message.userId)) || message.authorName;
    return {
      id: message.id,
      roomId: message.roomId,
      userId: message.userId,
      authorName,
      authorAvatarUrl: message.user?.avatarUrl ?? "",
      role: message.role,
      content: recalled ? "" : message.content,
      imageId: recalled ? null : message.imageId,
      imageUrl: recalled
        ? null
        : message.image?.url
          ? message.image.url
          : message.imageId
            ? imageUrl(message.imageId)
            : null,
      fileId: recalled ? null : message.fileId,
      fileUrl: recalled ? null : message.file?.url || null,
      fileName: recalled ? null : message.file?.filename || null,
      fileMimeType: recalled ? null : message.file?.mimeType || null,
      fileSizeBytes: recalled ? null : (message.file?.sizeBytes ?? null),
      replyToId: message.replyToId ?? null,
      replyTo: message.replyTo
        ? {
            id: message.replyTo.id,
            authorName:
              (message.replyTo.userId && names?.get(message.replyTo.userId)) ||
              message.replyTo.authorName,
            content: message.replyTo.recalledAt ? "" : message.replyTo.content,
            imageUrl: message.replyTo.recalledAt
              ? null
              : message.replyTo.image?.url || null,
            recalled: Boolean(message.replyTo.recalledAt),
          }
        : null,
      pinned: Boolean(message.pinnedAt),
      recalled,
      reactions: recalled
        ? []
        : this.summarizeReactions(message.reactions, names),
      createdAt: message.createdAt,
    };
  }
  /**
   * Tổng hợp các reactions của tin nhắn
   */
  private summarizeReactions(
    rows?: {
      emoji: string;
      userId: string;
      user?: { name: string; avatarUrl: string } | null;
    }[],
    names?: Map<string, string>,
  ): {
    emoji: string;
    count: number;
    userIds: string[];
    users: { id: string; name: string; avatarUrl: string }[];
  }[] {
    const grouped = new Map<
      string,
      { id: string; name: string; avatarUrl: string }[]
    >();
    for (const row of rows ?? []) {
      const users = grouped.get(row.emoji) ?? [];
      users.push({
        id: row.userId,
        name: names?.get(row.userId) || row.user?.name || "Thành viên",
        avatarUrl: row.user?.avatarUrl ?? "",
      });
      grouped.set(row.emoji, users);
    }
    return [...grouped.entries()].map(([emoji, users]) => ({
      emoji,
      count: users.length,
      userIds: users.map((user) => user.id),
      users,
    }));
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
        `Không gọi được AI: ${error instanceof Error ? error.message : "unknown"}`,
        job.agentName,
      );
    }
  }

  private shouldInvokeAgent(content: string, agentName: string) {
    if (!content) {
      return false;
    }
    if (AGENT_MENTION.test(content)) {
      return true;
    }
    const named = new RegExp(`@${agentName}\\b`, "i");
    return named.test(content);
  }
}
