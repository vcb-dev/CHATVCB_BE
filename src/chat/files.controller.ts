import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ImagesService } from './images.service.js';

@Controller('files')
export class FilesController {
  constructor(private readonly images: ImagesService) {}

  @Get(':id')
  async get(@Param('id') id: string, @Res() res: Response) {
    const file = await this.images.getFile(id);
    if (file.kind === 'redirect') {
      res.redirect(file.url);
      return;
    }
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    file.stream.pipe(res);
  }
}
