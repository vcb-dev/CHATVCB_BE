import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { CurrentUser } from "../auth/current-user.decorator.js";
import { JwtAuthGuard } from "../auth/jwt-auth.guard.js";
import { actorId, type JwtPayload } from "../auth/jwt-payload.js";
import { CreateDirectRoomDto } from "./dto/create-direct-room.dto.js";
import { CreateGroupRoomDto } from "./dto/create-group-room.dto.js";
import { RoomsService } from "./rooms.service.js";

@Controller("rooms")
@UseGuards(JwtAuthGuard)
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query("limit") limitRaw?: string,
    @Query("cursor") cursor?: string,
  ) {
    const parsed = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
    const limit =
      parsed != null && !Number.isNaN(parsed) ? parsed : undefined;
    return this.rooms.listForUser(actorId(user), user.team, {
      limit,
      cursor,
    });
  }

  @Post("direct")
  direct(@CurrentUser() user: JwtPayload, @Body() dto: CreateDirectRoomDto) {
    return this.rooms.findOrCreateDirect(actorId(user), dto.userId);
  }

  @Post()
  createGroup(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateGroupRoomDto,
  ) {
    return this.rooms.createGroup(actorId(user), dto.name, dto.memberIds);
  }

  @Delete(":roomId")
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(
    @Param("roomId", ParseUUIDPipe) roomId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.rooms.deleteGroup(roomId, actorId(user));
  }

  @Get(":roomId/members")
  members(@Param("roomId") roomId: string, @CurrentUser() user: JwtPayload) {
    return this.rooms.listMembers(roomId, actorId(user), user.team);
  }
}
