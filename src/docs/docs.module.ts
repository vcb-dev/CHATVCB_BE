import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DocsOauthController } from './docs-oauth.controller.js';
import { DocsController } from './docs.controller.js';
import { DocsService } from './docs.service.js';

@Module({
  imports: [AuthModule],
  controllers: [DocsController, DocsOauthController],
  providers: [DocsService],
})
export class DocsModule {}
