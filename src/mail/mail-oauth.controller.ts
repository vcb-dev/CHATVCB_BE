import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { MailService } from './mail.service.js';

@Controller('mail')
export class MailOauthController {
  constructor(private readonly mail: MailService) {}

  @Get('google/callback')
  async callback(
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ) {
    const app = this.mail.appUrl();
    if (error || !code || !state) {
      res.redirect(`${app}/?workspace=email&mail=error`);
      return;
    }
    try {
      await this.mail.finishGoogle(code, state);
      res.redirect(`${app}/?workspace=email&mail=ok`);
    } catch {
      res.redirect(`${app}/?workspace=email&mail=error`);
    }
  }
}
