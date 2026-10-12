import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { JwtPayload } from '../auth/jwt-payload.js';
import { CreateDocDto } from './dto/create-doc.dto.js';
import { UpdateDocDto } from './dto/update-doc.dto.js';
import { DocsService } from './docs.service.js';

@Controller('docs')
@UseGuards(JwtAuthGuard)
export class DocsController {
  constructor(private readonly docs: DocsService) {}

  @Get('google')
  google(@CurrentUser() user: JwtPayload, @Query('intent') intent?: string) {
    return this.docs.googleStartUrl(user.sub, intent);
  }

  @Get('google/status')
  googleStatus(@CurrentUser() user: JwtPayload) {
    return this.docs.googleStatus(user.sub);
  }

  @Get()
  list(
    @CurrentUser() user: JwtPayload,
    @Query('tab') tab?: string,
    @Query('q') q?: string,
  ) {
    return this.docs.list(user.sub, user.team, tab, q);
  }

  @Post()
  create(@CurrentUser() user: JwtPayload, @Body() dto: CreateDocDto) {
    return this.docs.create(user.sub, user.team, dto);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.docs.get(user.sub, user.team, id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtPayload, @Body() dto: UpdateDocDto) {
    return this.docs.update(user.sub, user.team, id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.docs.remove(user.sub, user.team, id);
  }
}
