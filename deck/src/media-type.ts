import { extname } from 'node:path';

/** The type a file in media/ is recorded and served as, by its extension. */
const TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.opus': 'audio/ogg',
  '.ogg': 'audio/ogg',
  '.weba': 'audio/webm',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.pdf': 'application/pdf',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.json': 'application/json',
  '.bin': 'application/octet-stream',
  '.woff2': 'font/woff2',
  '.vtt': 'text/vtt',
  '.txt': 'text/plain',
};

/** The type of a file in media/ by its name's extension: bytes of no type if it has none of these. */
export function mediaTypeOf(name: string): string {
  return TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream';
}
