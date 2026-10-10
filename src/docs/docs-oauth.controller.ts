import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { DocsService } from './docs.service.js';

@Controller('docs')
export class DocsOauthController {
  constructor(private readonly docs: DocsService) {}

  @Get('google/callback')
  async callback(
    @Res() res: Response,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ) {
    const app = this.docs.appUrl();
    if (error || !code || !state) {
      res.redirect(`${app}/?workspace=docs&google=error`);
      return;
    }
    try {
      const created = await this.docs.finishGoogle(code, state);
      if (created?.googleUrl) {
        res.redirect(created.googleUrl);
        return;
      }
      res.redirect(`${app}/?workspace=docs&google=ok`);
    } catch {
      res.redirect(`${app}/?workspace=docs&google=error`);
    }
  }
}
