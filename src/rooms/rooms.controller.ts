import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/jwt-payload.js';
import { RoomsService } from './rooms.service.js';

@Controller('rooms')
@UseGuards(JwtAuthGuard)
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.rooms.listForUser(user.sub, user.team);
  }

  @Get(':roomId/members')
  members(@Param('roomId') roomId: string, @CurrentUser() user: JwtPayload) {
    return this.rooms.listMembers(roomId, user.sub, user.team);
  }
}
