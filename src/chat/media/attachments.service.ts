import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { CloudinaryService } from "../../cloudinary/cloudinary.service.js";
import { PrismaService } from "../../prisma/prisma.service.js";
import { RoomsService } from "../../rooms/rooms.service.js";

export const CHAT_FILE_MAX_BYTES = 10 * 1024 * 1024;

const ALLOWED: Record<string, true> = {
  "application/pdf": true,
  "application/msword": true,
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": true,
  "application/vnd.ms-excel": true,
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": true,
  "application/vnd.ms-powerpoint": true,
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": true,
  "text/plain": true,
  "text/csv": true,
  "application/zip": true,
  "application/x-zip-compressed": true,
};

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async upload(
    roomId: string,
    userId: string,
    file: Express.Multer.File | undefined,
    team?: string,
  ) {
    await this.rooms.getMemberRoom(roomId, userId, team);
    if (!file?.buffer?.length) {
      throw new BadRequestException("Chưa chọn tệp.");
    }
    if (file.size > CHAT_FILE_MAX_BYTES) {
      throw new BadRequestException("Tệp tối đa 10MB.");
    }
    const mime = file.mimetype?.split(";")[0]?.trim() ?? "";
    if (!ALLOWED[mime]) {
      throw new BadRequestException(
        "Chỉ nhận PDF, Word, Excel, PowerPoint, TXT, CSV, ZIP.",
      );
    }
    const row = await this.prisma.chatAttachment.create({
      data: {
        roomId,
        userId,
        mimeType: mime,
        filename: file.originalname || "file",
        sizeBytes: file.size,
        storedName: "pending",
        url: "",
      },
    });
    try {
      const uploaded = await this.cloudinary.uploadRawBuffer(file.buffer, `file-${row.id}`);
      const attachment = await this.prisma.chatAttachment.update({
        where: { id: row.id },
        data: {
          storedName: uploaded.publicId,
          url: uploaded.url,
        },
      });
      return this.toPublic(attachment);
    } catch (error) {
      await this.prisma.chatAttachment
        .delete({ where: { id: row.id } })
        .catch(() => undefined);
      throw new BadRequestException(
        `Không tải được tệp lên Cloudinary: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }
  // list là phương thức để lấy danh sách các tệp trong phòng chat
  async list(roomId: string, userId: string, team?: string) {
    await this.rooms.getMemberRoom(roomId, userId, team);
    // sent là phương thức để lấy danh sách các tệp đã gửi trong phòng chat tức là tệp đã được gửi trong phòng chat
    // library là phương thức để lấy danh sách các tệp đã lưu trong thư viện tức là tệp đã được upload lên cloudinary
    const [sent, library] = await Promise.all([
      this.prisma.message.findMany({
        where: {
          roomId,
          recalledAt: null,
          fileId: { not: null },
          hides: { none: { userId } },
        },
        orderBy: { createdAt: "desc" },
        take: 80,
        select: {
          createdAt: true,
          fileId: true,
          file: true,
        },
      }),
      this.prisma.chatAttachment.findMany({
        where: { roomId, storedName: { not: "pending" } },
        orderBy: { createdAt: "desc" },
        take: 80,
      }),
    ]);
    // seen là phương thức để lấy danh sách các tệp đã xem
    // files là phương thức để lấy danh sách các tệp
    const seen = new Set<string>();
    const files: ReturnType<AttachmentsService["toPublic"]>[] = [];
    for (const row of sent) {
      const file = row.file;
      const id = file?.id || row.fileId;
      if (!id || seen.has(id) || !file || file.storedName === "pending") {
        continue;
      }
      seen.add(id);
      files.push(this.toPublic(file));
    }
    for (const item of library) {
      if (seen.has(item.id)) {
        continue;
      }
      seen.add(item.id);
      files.push(this.toPublic(item));
    }
    return files;
  }

  async assertInRoom(fileId: string, roomId: string) {
    const file = await this.prisma.chatAttachment.findFirst({
      where: { id: fileId, roomId },
      select: { id: true },
    });
    if (!file) {
      throw new BadRequestException("Tệp không thuộc phòng chat này.");
    }
  }

  async getDownload(id: string) {
    const row = await this.prisma.chatAttachment.findUnique({ where: { id } });
    if (!row || row.storedName === "pending") {
      throw new NotFoundException("Không tìm thấy tệp.");
    }
    if (row.url?.startsWith("http")) {
      return {
        kind: "redirect" as const,
        url: row.url,
        filename: row.filename,
      };
    }
    throw new NotFoundException("Không tìm thấy tệp.");
  }

  private toPublic(row: {
    id: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    url: string;
    createdAt: Date;
  }) {
    return {
      id: row.id,
      filename: row.filename,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      url: row.url,
      createdAt: row.createdAt,
    };
  }
}
