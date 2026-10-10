import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/jwt-payload.js';
import { ConnectMailDto } from './dto/connect-mail.dto.js';
import { MailService } from './mail.service.js';

@Controller('mail')
@UseGuards(JwtAuthGuard)
export class MailController {
  constructor(private readonly mail: MailService) {}

  @Get('google')
  google(@CurrentUser() user: JwtPayload) {
    return this.mail.googleStartUrl(user.sub);
  }

  @Get('accounts')
  accounts(@CurrentUser() user: JwtPayload) {
    return this.mail.listAccounts(user.sub);
  }

  @Post('accounts')
  connect(@CurrentUser() user: JwtPayload, @Body() dto: ConnectMailDto) {
    return this.mail.connect(user.sub, dto);
  }

  @Delete('accounts/:id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.mail.remove(user.sub, id);
  }

  @Get('accounts/:id/inbox')
  inbox(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
    @Query('limit') limit?: string,
  ) {
    return this.mail.inbox(user.sub, id, limit ? Number(limit) : 40);
  }

  @Get('accounts/:id/messages/:uid')
  message(
    @Param('id') id: string,
    @Param('uid') uid: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.mail.message(user.sub, id, uid);
  }
}
