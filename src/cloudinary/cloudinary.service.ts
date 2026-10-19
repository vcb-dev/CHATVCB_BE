import { Injectable } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';

let configured = false;

function ensureConfig() {
  if (configured) {
    return;
  }
  const cloud_name = process.env.CLOUDINARY_CLOUD_NAME;
  const api_key = process.env.CLOUDINARY_API_KEY;
  const api_secret = process.env.CLOUDINARY_API_SECRET;
  if (!cloud_name || !api_key || !api_secret) {
    throw new Error('Thiếu biến Cloudinary trong .env');
  }
  cloudinary.config({ cloud_name, api_key, api_secret, secure: true });
  configured = true;
}

function folder() {
  return process.env.CLOUDINARY_FOLDER || 'CHATVCB';
}

@Injectable()
export class CloudinaryService {
  uploadImageBuffer(buffer: Buffer, publicId: string, mimeType: string) {
    ensureConfig();
    return new Promise<{ url: string; publicId: string }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: folder(),
          public_id: publicId,
          overwrite: true,
          resource_type: 'image',
          format: mimeType === 'image/png' ? 'png' : mimeType === 'image/gif' ? 'gif' : undefined,
        },
        (error, result) => {
          if (error || !result?.secure_url) {
            reject(error ?? new Error('Cloudinary không trả URL'));
            return;
          }
          resolve({ url: result.secure_url, publicId: result.public_id });
        },
      );
      stream.end(buffer);
    });
  }

  uploadRawBuffer(buffer: Buffer, publicId: string) {
    ensureConfig();
    return new Promise<{ url: string; publicId: string }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: folder(),
          public_id: publicId,
          overwrite: true,
          resource_type: 'raw',
        },
        (error, result) => {
          if (error || !result?.secure_url) {
            reject(error ?? new Error('Cloudinary không trả URL'));
            return;
          }
          resolve({ url: result.secure_url, publicId: result.public_id });
        },
      );
      stream.end(buffer);
    });
  }

  uploadAvatarBuffer(buffer: Buffer, publicId: string) {
    ensureConfig();
    return new Promise<{ url: string; publicId: string }>((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: folder(),
          public_id: publicId,
          overwrite: true,
          resource_type: 'image',
          format: 'jpg',
          transformation: [
            { width: 400, height: 400, crop: 'fill', gravity: 'auto', quality: 'auto:good' },
          ],
        },
        (error, result) => {
          if (error || !result?.secure_url) {
            reject(error ?? new Error('Cloudinary không trả URL'));
            return;
          }
          resolve({ url: result.secure_url, publicId: result.public_id });
        },
      );
      stream.end(buffer);
    });
  }
}
