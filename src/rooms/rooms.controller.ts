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
import { AddRoomMemberDto } from "./dto/add-room-member.dto.js";
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

  @Get("search")
  search(@CurrentUser() user: JwtPayload, @Query("q") q?: string) {
    return this.rooms.search(actorId(user), q);
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

  @Post(":roomId/members")
  addMember(
    @Param("roomId", ParseUUIDPipe) roomId: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: AddRoomMemberDto,
  ) {
    return this.rooms.addMember(roomId, actorId(user), dto.userId);
  }

  @Delete(":roomId/members/:userId")
  removeMember(
    @Param("roomId", ParseUUIDPipe) roomId: string,
    @Param("userId", ParseUUIDPipe) userId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.rooms.removeMember(roomId, actorId(user), userId);
  }
}
