import { Injectable } from '@nestjs/common';
import type { Server } from 'socket.io';

@Injectable()
export class ChatEvents {
  server: Server | null = null;

  emitToRoom(roomId: string, event: string, payload: unknown) {
    this.server?.to(`room:${roomId}`).emit(event, payload);
  }
}
