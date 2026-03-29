import {
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, rm, stat } from 'fs/promises';
import path from 'path';

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export const uploadsRoot = path.resolve(process.cwd(), 'uploads');

export async function ensureUploadsDirectory(segment?: string) {
  const target = segment ? path.join(uploadsRoot, segment) : uploadsRoot;
  await mkdir(target, { recursive: true });
  return target;
}

export function validateImageFile(file: {
  mimetype?: string;
  size?: number;
  originalname?: string;
} | null | undefined) {
  if (!file) {
    throw new BadRequestException('Файл изображения обязателен');
  }

  if (!file.mimetype || !ALLOWED_MIME_TYPES.has(file.mimetype)) {
    throw new BadRequestException('Допустимы только JPG, PNG и WEBP изображения');
  }

  if ((file.size ?? 0) <= 0 || (file.size ?? 0) > MAX_FILE_SIZE_BYTES) {
    throw new BadRequestException('Размер изображения должен быть не больше 5 МБ');
  }
}

export function buildImageStorageName(originalname?: string) {
  const ext = getSafeExtension(originalname);
  return `${Date.now()}-${randomUUID()}${ext}`;
}

export function toPublicUploadUrl(...segments: string[]) {
  return `/${['uploads', ...segments].map((value) => value.replace(/^\/+|\/+$/g, '')).join('/')}`;
}

export async function deleteUploadedFile(publicPath?: string | null) {
  if (!publicPath || !publicPath.startsWith('/uploads/')) {
    return;
  }

  const relativePath = publicPath.replace(/^\/uploads\//, '');
  const absolutePath = path.join(uploadsRoot, relativePath);

  try {
    await stat(absolutePath);
    await rm(absolutePath, { force: true });
  } catch {
    return;
  }
}

export function normalizeStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter(Boolean);
}

export function parseJsonArrayField(input: string | undefined): string[] {
  if (!input) {
    return [];
  }

  try {
    const parsed = JSON.parse(input);
    return normalizeStringArray(parsed);
  } catch {
    throw new BadRequestException('Ожидался JSON-массив строк');
  }
}

function getSafeExtension(originalname?: string) {
  const ext = originalname ? path.extname(originalname).toLowerCase() : '';

  if (ext === '.jpg' || ext === '.jpeg' || ext === '.png' || ext === '.webp') {
    return ext;
  }

  if (!originalname) {
    return '.jpg';
  }

  throw new InternalServerErrorException('Не удалось определить расширение изображения');
}
