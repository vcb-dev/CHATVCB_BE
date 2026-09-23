import { Module } from '@nestjs/common';
import { AgentClientService } from './agent.client.js';

@Module({
  providers: [AgentClientService],
  exports: [AgentClientService],
})
export class AgentModule {}
