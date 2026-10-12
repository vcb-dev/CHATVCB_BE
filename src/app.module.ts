import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgentModule } from './agent/agent.module.js';
import { AuthModule } from './auth/auth.module.js';
import { ChatModule } from './chat/chat.module.js';
import { HealthController } from './health.controller.js';
import { DocsModule } from './docs/docs.module.js';
import { MailModule } from './mail/mail.module.js';
import { MeetingsModule } from './meetings/meetings.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { RoomsModule } from './rooms/rooms.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    RoomsModule,
    ChatModule,
    MeetingsModule,
    DocsModule,
    MailModule,
    AgentModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
