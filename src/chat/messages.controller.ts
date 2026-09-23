import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/jwt-payload.js';
import { CreateMessageDto } from './dto/create-message.dto.js';
import { MessagesService } from './messages.service.js';

@Controller('rooms/:roomId/messages')
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  list(@Param('roomId') roomId: string, @CurrentUser() user: JwtPayload) {
    return this.messages.list(roomId, user.sub);
  }

  @Post()
  create(
    @Param('roomId') roomId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateMessageDto,
  ) {
    return this.messages.createFromUser(roomId, user.sub, user.name, dto.content);
  }
}
