import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { extname, join, relative } from 'node:path';
import { Readable } from 'node:stream';
import type { MediaJson } from '@tobos/deck';
import { api, failure, request } from './api.ts';
import { CliError } from './out.ts';

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
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.json': 'application/json',
  '.bin': 'application/octet-stream',
  '.woff2': 'font/woff2',
  '.vtt': 'text/vtt',
  '.txt': 'text/plain',
};

function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (d) => hash.update(d))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.name.startsWith('.') ? [] : d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)],
  );
}

/**
 * Bring media.json up to date with media/: hash every file. Entries whose file isn't here
 * stay (a fresh clone has media.json but no media/; the server has the files).
 */
export async function syncMediaJson(root: string): Promise<{ media: MediaJson; changed: boolean }> {
  const file = join(root, 'media.json');
  const before = existsSync(file) ? readFileSync(file, 'utf8') : '{}\n';
  const media: MediaJson = JSON.parse(before);
  // Hashes by size and modification time, so unchanged videos aren't re-read on every push.
  const cacheFile = join(root, '.tobos', 'media-cache.json');
  let cache: Record<string, { size: number; mtime: number; hash: string }> = {};
  try {
    cache = JSON.parse(readFileSync(cacheFile, 'utf8'));
  } catch {
    // no cache yet
  }
  const dir = join(root, 'media');
  for (const path of walk(dir)) {
    const name = relative(dir, path).split('\\').join('/');
    const { size, mtimeMs } = statSync(path);
    const cached = cache[name];
    const hash =
      cached && cached.size === size && cached.mtime === mtimeMs
        ? cached.hash
        : await hashFile(path);
    cache[name] = { size, mtime: mtimeMs, hash };
    media[name] = {
      hash,
      size,
      type: TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream',
    };
  }
  mkdirSync(join(root, '.tobos'), { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(cache));
  const sorted = Object.fromEntries(Object.entries(media).sort(([a], [b]) => a.localeCompare(b)));
  const after = JSON.stringify(sorted, null, 2) + '\n';
  if (after !== before) writeFileSync(file, after);
  return { media: sorted, changed: after !== before };
}

/**
 * Upload what the server asks for: files it lacks, or doesn't know this user has. They count
 * toward the deck's account.
 */
export async function uploadMedia(
  root: string,
  media: MediaJson,
  server: string,
  account: string,
  note: (m: string) => void,
) {
  const hashes = [...new Set(Object.values(media).map((m) => m.hash))];
  if (hashes.length === 0) return [];
  const { missing } = await api<{ missing: string[] }>('/api/media/missing', {
    body: { hashes },
    server,
  });
  const uploaded: string[] = [];
  for (const hash of missing) {
    const [name, entry] = Object.entries(media).find(([, m]) => m.hash === hash)!;
    const path = join(root, 'media', name);
    if (!existsSync(path))
      throw new CliError(
        `media/${name} is in media.json but not on this machine, and the server doesn't have it.`,
      );
    note(`uploading media/${name} (${Math.round(entry.size / 1000)} kB)`);
    const response = await request(`/api/media/${hash}?account=${account}`, {
      method: 'PUT',
      body: Readable.toWeb(createReadStream(path)) as ReadableStream,
      contentType: entry.type,
      server,
    });
    if (!response.ok)
      throw failure(
        response,
        await response.json().catch(() => ({})),
        `Uploading media/${name} failed: `,
      );
    uploaded.push(name);
  }
  return uploaded;
}
