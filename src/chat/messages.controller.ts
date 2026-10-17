import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import type { JwtPayload } from "../auth/jwt-payload.js";
import { CreateMessageDto } from "./dto/create-message.dto.js";
import { PinMessageDto } from "./dto/pin-message.dto.js";
import { ReactMessageDto } from "./dto/react-message.dto.js";
import { MessagesService } from "./messages.service.js";

@Controller("rooms/:roomId/messages")
@UseGuards(JwtAuthGuard)
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  list(
    @Param("roomId") roomId: string,
    @CurrentUser() user: JwtPayload,
    @Query("limit") limitRaw?: string,
    @Query("cursor") cursor?: string,
  ) {
    const parsed = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
    const limit = parsed != null && !Number.isNaN(parsed) ? parsed : undefined;
    return this.messages.list(roomId, user.sub, user.team, { limit, cursor });
  }

  @Post()
  create(
    @Param("roomId") roomId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateMessageDto,
  ) {
    return this.messages.createFromUser(
      roomId,
      user.sub,
      user.name,
      dto.content ?? "",
      user.team,
      dto.imageId,
      dto.replyToId,
      dto.fileId,
    );
  }

  @Patch(":messageId/pin")
  pin(
    @Param("roomId") roomId: string,
    @Param("messageId") messageId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: PinMessageDto,
  ) {
    return this.messages.pin(
      roomId,
      user.sub,
      messageId,
      body.pinned !== false,
      user.team,
    );
  }

  @Post(":messageId/reactions")
  react(
    @Param("roomId") roomId: string,
    @Param("messageId") messageId: string,
    @CurrentUser() user: JwtPayload,
    @Body() body: ReactMessageDto,
  ) {
    return this.messages.react(
      roomId,
      user.sub,
      messageId,
      body.emoji,
      user.team,
    );
  }

  @Post(":messageId/recall")
  recall(
    @Param("roomId") roomId: string,
    @Param("messageId") messageId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.messages.recall(roomId, user.sub, messageId, user.team);
  }

  @Delete(":messageId")
  hide(
    @Param("roomId") roomId: string,
    @Param("messageId") messageId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.messages.hide(roomId, user.sub, messageId, user.team);
  }
}
