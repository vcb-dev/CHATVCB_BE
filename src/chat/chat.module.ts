import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CloudinaryModule } from '../cloudinary/cloudinary.module.js';
import { MeetingsModule } from '../meetings/meetings.module.js';
import { RoomsModule } from '../rooms/rooms.module.js';
import { AttachmentsService } from './media/attachments.service.js';
import { FilesController } from './media/files.controller.js';
import { GifsController } from './media/gifs.controller.js';
import { ImagesService } from './media/images.service.js';
import { RoomMediaController } from './media/room-media.controller.js';
import { MessagesController } from './messages/messages.controller.js';
import { MessagesService } from './messages/messages.service.js';
import { ChatEvents } from './realtime/chat.events.js';
import { ChatGateway } from './realtime/chat.gateway.js';

@Module({
  imports: [AuthModule, CloudinaryModule, RoomsModule, MeetingsModule, AgentModule],
  controllers: [MessagesController, RoomMediaController, FilesController, GifsController],
  providers: [MessagesService, ImagesService, AttachmentsService, ChatGateway, ChatEvents],
  exports: [MessagesService],
})
export class ChatModule {}
