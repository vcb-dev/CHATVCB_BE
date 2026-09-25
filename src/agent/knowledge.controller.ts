import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/jwt-payload.js';
import { CreateKnowledgeDto } from './dto/create-knowledge.dto.js';
import { KnowledgeService } from './knowledge.service.js';

@Controller('agents/:agentName/knowledge')
@UseGuards(JwtAuthGuard)
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get()
  list(@Param('agentName') agentName: string, @CurrentUser() user: JwtPayload) {
    return this.knowledge.list(agentName, user.team);
  }

  @Post()
  create(
    @Param('agentName') agentName: string,
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateKnowledgeDto,
  ) {
    return this.knowledge.create(agentName, user.team, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.knowledge.remove(id, user.team);
  }
}
