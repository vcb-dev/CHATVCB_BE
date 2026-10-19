import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { createReadStream, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CloudinaryService } from '../../cloudinary/cloudinary.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { RoomsService } from '../../rooms/rooms.service.js';
import { imageUrl, uploadDir } from './upload-dir.js';

const ALLOWED: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

@Injectable()
export class ImagesService implements OnModuleInit {
  private readonly logger = new Logger(ImagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  async onModuleInit() {
    try {
      await this.migrateLocalToCloudinary();
    } catch (error) {
      this.logger.error(
        `Không đẩy ảnh cũ lên Cloudinary: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  async upload(
    roomId: string,
    userId: string,
    file: Express.Multer.File | undefined,
    team?: string,
  ) {
    await this.rooms.getMemberRoom(roomId, userId, team);
    if (!file?.buffer?.length) {
      throw new BadRequestException('Chưa chọn ảnh.');
    }
    const ext = ALLOWED[file.mimetype];
    if (!ext) {
      throw new BadRequestException('Chỉ nhận ảnh JPG, PNG, GIF, WebP.');
    }
    const row = await this.prisma.chatImage.create({
      data: {
        roomId,
        userId,
        mimeType: file.mimetype,
        filename: file.originalname || `anh${ext}`,
        storedName: 'pending',
        url: '',
      },
    });
    try {
      const uploaded = await this.cloudinary.uploadImageBuffer(file.buffer, row.id, file.mimetype);
      const image = await this.prisma.chatImage.update({
        where: { id: row.id },
        data: {
          storedName: uploaded.publicId,
          url: uploaded.url,
        },
      });
      return this.toPublic(image);
    } catch (error) {
      await this.prisma.chatImage.delete({ where: { id: row.id } }).catch(() => undefined);
      throw new BadRequestException(
        `Không tải được ảnh lên Cloudinary: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  async uploadAvatar(
    roomId: string,
    userId: string,
    file: Express.Multer.File | undefined,
    team?: string,
  ) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Chưa chọn ảnh.');
    }
    if (!ALLOWED[file.mimetype]) {
      throw new BadRequestException('Chỉ nhận ảnh JPG, PNG, GIF, WebP.');
    }
    const uploaded = await this.cloudinary.uploadAvatarBuffer(file.buffer, `room-${roomId}`);
    return this.rooms.updateAvatar(roomId, userId, uploaded.url, team);
  }

  async list(roomId: string, userId: string, team?: string) {
    await this.rooms.getMemberRoom(roomId, userId, team);
    const [sent, library] = await Promise.all([
      this.prisma.message.findMany({
        where: {
          roomId,
          recalledAt: null,
          imageId: { not: null },
          hides: { none: { userId } },
        },
        orderBy: { createdAt: 'desc' },
        take: 80,
        select: {
          createdAt: true,
          imageId: true,
          image: { select: { id: true, filename: true, url: true, createdAt: true } },
        },
      }),
      this.prisma.chatImage.findMany({
        where: { roomId },
        orderBy: { createdAt: 'desc' },
        take: 80,
      }),
    ]);
    const seen = new Set<string>();
    const photos: ReturnType<ImagesService['toPublic']>[] = [];
    for (const row of sent) {
      const image = row.image;
      const id = image?.id || row.imageId;
      if (!id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      photos.push(
        this.toPublic(
          image ?? {
            id,
            filename: 'Ảnh',
            createdAt: row.createdAt,
            url: '',
          },
        ),
      );
    }
    for (const item of library) {
      if (seen.has(item.id)) {
        continue;
      }
      seen.add(item.id);
      photos.push(this.toPublic(item));
    }
    return photos;
  }

  async getFile(id: string) {
    const image = await this.prisma.chatImage.findUnique({ where: { id } });
    if (!image || image.storedName === 'pending') {
      throw new NotFoundException('Không tìm thấy ảnh.');
    }
    if (image.url?.startsWith('http')) {
      return { kind: 'redirect' as const, url: image.url };
    }
    const path = join(uploadDir(), image.storedName);
    if (!existsSync(path)) {
      throw new NotFoundException('Không tìm thấy ảnh.');
    }
    return {
      kind: 'file' as const,
      mimeType: image.mimeType,
      stream: createReadStream(path),
    };
  }

  async attachRemote(roomId: string, userId: string, url: string, team?: string) {
    await this.rooms.getMemberRoom(roomId, userId, team);
    const href = url.trim();
    if (!/^https:\/\//i.test(href)) {
      throw new BadRequestException('Link ảnh không hợp lệ.');
    }
    const image = await this.prisma.chatImage.create({
      data: {
        roomId,
        userId,
        mimeType: 'image/gif',
        filename: 'gif.gif',
        storedName: 'remote',
        url: href,
      },
    });
    return this.toPublic(image);
  }

  async assertInRoom(imageId: string, roomId: string) {
    const image = await this.prisma.chatImage.findFirst({
      where: { id: imageId, roomId },
    });
    if (!image) {
      throw new BadRequestException('Ảnh không thuộc phòng này.');
    }
    return image;
  }

  publicUrl(image: { id: string; url?: string | null }) {
    return image.url && image.url.startsWith('http') ? image.url : imageUrl(image.id);
  }

  private async migrateLocalToCloudinary() {
    const rows = await this.prisma.chatImage.findMany({
      where: {
        OR: [{ url: '' }, { url: { startsWith: '/' } }],
      },
    });
    if (!rows.length) {
      return;
    }
    let ok = 0;
    for (const row of rows) {
      if (row.url.startsWith('http')) {
        continue;
      }
      const path = join(uploadDir(), row.storedName);
      if (!existsSync(path) || row.storedName === 'pending') {
        continue;
      }
      const buffer = await readFile(path);
      const uploaded = await this.cloudinary.uploadImageBuffer(buffer, row.id, row.mimeType);
      await this.prisma.chatImage.update({
        where: { id: row.id },
        data: { storedName: uploaded.publicId, url: uploaded.url },
      });
      ok += 1;
    }
    if (ok) {
      this.logger.log(`Đã đẩy ${ok} ảnh lên Cloudinary`);
    }
  }

  private toPublic(image: {
    id: string;
    filename: string;
    createdAt: Date;
    url?: string | null;
  }) {
    return {
      id: image.id,
      filename: image.filename,
      url: this.publicUrl(image),
      createdAt: image.createdAt,
    };
  }
}
