import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { MeetingsModule } from '../meetings/meetings.module.js';
import { RoomsModule } from '../rooms/rooms.module.js';
import { ChatEvents } from './chat.events.js';
import { ChatGateway } from './chat.gateway.js';
import { FilesController } from './files.controller.js';
import { GifsController } from './gifs.controller.js';
import { ImagesService } from './images.service.js';
import { MessagesController } from './messages.controller.js';
import { MessagesService } from './messages.service.js';
import { RoomMediaController } from './room-media.controller.js';

@Module({
  imports: [AuthModule, RoomsModule, MeetingsModule, AgentModule],
  controllers: [MessagesController, RoomMediaController, FilesController, GifsController],
  providers: [MessagesService, ImagesService, ChatGateway, ChatEvents],
  exports: [MessagesService],
})
export class ChatModule {}
