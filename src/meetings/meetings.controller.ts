import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/jwt-payload.js';
import { CreateMeetingDto } from './dto/create-meeting.dto.js';
import { JoinMeetingDto } from './dto/join-meeting.dto.js';
import { UpdateNotesDto } from './dto/update-notes.dto.js';
import { MeetingsService } from './meetings.service.js';

@Controller('meetings')
@UseGuards(JwtAuthGuard)
export class MeetingsController {
  constructor(private readonly meetings: MeetingsService) {}

  @Get()
  list(@CurrentUser() user: JwtPayload) {
    return this.meetings.list(user.team);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateMeetingDto) {
    return this.meetings.create(user.sub, user.team, dto.title, dto.scheduledAt);
  }

  @Post('join')
  join(@CurrentUser() user: JwtPayload, @Body() dto: JoinMeetingDto) {
    return this.meetings.join(user.sub, user.team, dto.code);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.meetings.getForTeam(id, user.team);
  }

  @Patch(':id/notes')
  notes(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: UpdateNotesDto) {
    return this.meetings.saveNotes(id, user.sub, user.team, dto.notes);
  }

  @Post(':id/leave')
  leave(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.meetings.leave(id, user.sub, user.team);
  }

  @Post(':id/end')
  end(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.meetings.end(id, user.sub, user.team);
  }
}
