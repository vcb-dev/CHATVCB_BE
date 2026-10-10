import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export function uploadDir() {
  const dir = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function imageUrl(imageId: string) {
  return `/api/files/${imageId}`;
}
