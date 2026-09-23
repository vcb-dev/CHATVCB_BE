import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { RoomsModule } from '../rooms/rooms.module.js';
import { ChatEvents } from './chat.events.js';
import { ChatGateway } from './chat.gateway.js';
import { MessagesController } from './messages.controller.js';
import { MessagesService } from './messages.service.js';

@Module({
  imports: [AuthModule, RoomsModule, AgentModule],
  controllers: [MessagesController],
  providers: [MessagesService, ChatGateway, ChatEvents],
  exports: [MessagesService],
})
export class ChatModule {}
