import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';

type GifItem = { id: string; url: string; preview: string };

@Controller('gifs')
@UseGuards(JwtAuthGuard)
export class GifsController {
  @Get()
  async search(@Query('q') q?: string) {
    const key = process.env.TENOR_API_KEY;
    if (!key) {
      return { items: [] as GifItem[] };
    }
    const query = q?.trim();
    const endpoint = query
      ? `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query)}&key=${key}&limit=24&media_filter=gif`
      : `https://tenor.googleapis.com/v2/featured?key=${key}&client_key=chatvcb&limit=24&media_filter=gif`;
    const response = await fetch(endpoint);
    if (!response.ok) {
      return { items: [] as GifItem[] };
    }
    const data = (await response.json()) as {
      results?: {
        id: string;
        media_formats?: { gif?: { url?: string }; tinygif?: { url?: string } };
      }[];
    };
    const items = (data.results ?? [])
      .map((item) => ({
        id: item.id,
        url: item.media_formats?.gif?.url || item.media_formats?.tinygif?.url || '',
        preview: item.media_formats?.tinygif?.url || item.media_formats?.gif?.url || '',
      }))
      .filter((item) => item.url);
    return { items };
  }
}
