import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AttachmentsService } from './attachments.service.js';
import { ImagesService } from './images.service.js';

@Controller('files')
export class FilesController {
  constructor(
    private readonly images: ImagesService,
    private readonly attachments: AttachmentsService,
  ) {}

  @Get(':id')
  async get(@Param('id') id: string, @Res() res: Response) {
    try {
      const file = await this.images.getFile(id);
      if (file.kind === 'redirect') {
        res.redirect(file.url);
        return;
      }
      res.setHeader('Content-Type', file.mimeType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      file.stream.pipe(res);
      return;
    } catch {
      const attachment = await this.attachments.getDownload(id);
      res.redirect(attachment.url);
    }
  }
}
