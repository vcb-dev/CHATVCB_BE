import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/jwt-payload.js';
import { UpdateNicknameDto } from '../rooms/dto/update-nickname.dto.js';
import { UpdateRoomDto } from '../rooms/dto/update-room.dto.js';
import { RoomsService } from '../rooms/rooms.service.js';
import { ChatEvents } from './chat.events.js';
import { MarkReadDto } from './dto/mark-read.dto.js';
import { AttachmentsService } from './attachments.service.js';
import { ImagesService } from './images.service.js';
import { MessagesService } from './messages.service.js';

@Controller('rooms/:roomId')
@UseGuards(JwtAuthGuard)
export class RoomMediaController {
  constructor(
    private readonly images: ImagesService,
    private readonly attachments: AttachmentsService,
    private readonly messages: MessagesService,
    private readonly rooms: RoomsService,
    private readonly events: ChatEvents,
  ) {}

  @Patch('settings')
  async updateSettings(
    @Param('roomId') roomId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateRoomDto,
  ) {
    if (!dto.name) {
      throw new BadRequestException('Chưa có thay đổi.');
    }
    const room = await this.rooms.updateName(roomId, user.sub, dto.name, user.team);
    this.events.emitToRoom(roomId, 'room.updated', room);
    return room;
  }

  @Post('avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  async uploadAvatar(
    @Param('roomId') roomId: string,
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Chưa chọn ảnh.');
    }
    const room = await this.images.uploadAvatar(roomId, user.sub, file, user.team);
    this.events.emitToRoom(roomId, 'room.updated', room);
    return room;
  }

  @Patch('nickname')
  async updateNickname(
    @Param('roomId') roomId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: UpdateNicknameDto,
  ) {
    const members = await this.rooms.updateNickname(
      roomId,
      user.sub,
      dto.userId,
      dto.nickname ?? '',
      user.team,
    );
    this.events.emitToRoom(roomId, 'room.members', members);
    return members;
  }

  @Get('images')
  listImages(@Param('roomId') roomId: string, @CurrentUser() user: JwtPayload) {
    return this.images.list(roomId, user.sub, user.team);
  }

  @Post('images')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
    }),
  )
  uploadImage(
    @Param('roomId') roomId: string,
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Chưa chọn ảnh.');
    }
    return this.images.upload(roomId, user.sub, file, user.team);
  }

  @Get('files')
  listFiles(@Param('roomId') roomId: string, @CurrentUser() user: JwtPayload) {
    return this.attachments.list(roomId, user.sub, user.team);
  }

  @Post('files')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  uploadFile(
    @Param('roomId') roomId: string,
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Chưa chọn tệp.');
    }
    return this.attachments.upload(roomId, user.sub, file, user.team);
  }

  @Post('images/remote')
  attachRemote(
    @Param('roomId') roomId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: { url?: string },
  ) {
    if (!body.url) {
      throw new BadRequestException('Thiếu link ảnh.');
    }
    return this.images.attachRemote(roomId, user.sub, body.url, user.team);
  }

  @Get('links')
  listLinks(@Param('roomId') roomId: string, @CurrentUser() user: JwtPayload) {
    return this.rooms.listLinks(roomId, user.sub, user.team);
  }

  @Get('pins')
  listPins(@Param('roomId') roomId: string, @CurrentUser() user: JwtPayload) {
    return this.messages.listPinned(roomId, user.sub, user.team);
  }

  @Get('reads')
  listReads(@Param('roomId') roomId: string, @CurrentUser() user: JwtPayload) {
    return this.messages.listReads(roomId, user.sub, user.team);
  }

  @Post('read')
  markRead(
    @Param('roomId') roomId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: MarkReadDto,
  ) {
    return this.messages.markRead(roomId, user.sub, dto.messageId, user.team);
  }
}
