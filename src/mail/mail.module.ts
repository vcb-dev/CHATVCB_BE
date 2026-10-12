import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { MailOauthController } from './mail-oauth.controller.js';
import { MailController } from './mail.controller.js';
import { MailService } from './mail.service.js';

@Module({
  imports: [AuthModule],
  controllers: [MailController, MailOauthController],
  providers: [MailService],
})
export class MailModule {}
