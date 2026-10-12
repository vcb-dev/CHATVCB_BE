import { Module } from '@nestjs/common';
import { AgentClientService } from './agent.client.js';
import { KnowledgeController } from './knowledge.controller.js';
import { KnowledgeService } from './knowledge.service.js';

@Module({
  controllers: [KnowledgeController],
  providers: [AgentClientService, KnowledgeService],
  exports: [AgentClientService, KnowledgeService],
})
export class AgentModule {}
