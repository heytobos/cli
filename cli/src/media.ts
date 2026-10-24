import { createHash } from 'node:crypto';
import {
  createReadStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';
import { Readable } from 'node:stream';
import { formatMediaJson, mediaTypeOf, type MediaJson } from '@tobos/deck';
import { api, failure, request } from './api.ts';
import { CliError } from './out.ts';

/** Sound as it was recorded, five to ten times the size of AAC that a room hears no difference from. */
const LOSSLESS = /\.(wav|aiff?|flac)$/i;

/** A path as a shell takes it as one word: quoted where it has anything but plain characters. */
const shellWord = (path: string) =>
  /^[\w./-]+$/.test(path) ? path : `'${path.replaceAll("'", "'\\''")}'`;

/**
 * What `tobos push` says about a file in media/ that every viewer would download more of than it
 * needs: lossless sound over 1 MB, with the ffmpeg line that makes it AAC, and any file over 25 MB.
 */
export function sizeNote(name: string, size: number): string | undefined {
  const mb = Math.round(size / 1_000_000);
  if (LOSSLESS.test(name) && size > 1_000_000) {
    const from = shellWord(`media/${name}`);
    const to = shellWord(`media/${name.replace(LOSSLESS, '.m4a')}`);
    return `note: media/${name} is lossless sound, ${mb} MB. As AAC it takes a fraction of that, and sounds the same in a room: ffmpeg -i ${from} -c:a aac -b:a 128k ${to}`;
  }
  if (size > 25_000_000)
    return `note: media/${name} is ${mb} MB. Every viewer downloads it; size it for the stage.`;
  return undefined;
}

function hashFile(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(path)
      .on('data', (d) => hash.update(d))
      .on('end', () => resolve(hash.digest('hex')))
      .on('error', reject);
  });
}

/**
 * The files in media/, and in its folders. A link is neither, media/ itself included: what it
 * points to may be anywhere on this machine, and goes nowhere from it, as git and the server skip
 * links too.
 */
function walk(dir: string): string[] {
  if (!existsSync(dir) || !lstatSync(dir).isDirectory()) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.name.startsWith('.')
      ? []
      : d.isDirectory()
        ? walk(join(dir, d.name))
        : d.isFile()
          ? [join(dir, d.name)]
          : [],
  );
}

/**
 * The file in media/ a media.json name stands for, if it is one: a name that leaves media/, or
 * a link rather than a file, is refused, whoever wrote media.json. So is a link on the way to it,
 * media/ or a folder in it: the file is found where its name says, once the deck's own folder is.
 */
function mediaFile(root: string, name: string): string {
  // Its folders split at /, and on Windows at \ too, where that separates them as well.
  const parts = name.split(process.platform === 'win32' ? /[\\/]/ : '/');
  if (name.startsWith('/') || name.includes('\0') || parts.some((p) => p === '' || p === '..'))
    throw new CliError(`media.json names "${name}", which isn't a file in media/.`);
  const path = join(root, 'media', name);
  const refused = new CliError(
    `media/${name} is a link or a folder, not a file: media/ holds files only.`,
  );
  let entry;
  try {
    // The name itself, not where a link leads: a link is refused whether or not its target is there.
    entry = lstatSync(path, { throwIfNoEntry: false });
  } catch (error) {
    // Not here: a file where a folder on the way would be, or a name too long to be one.
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOTDIR' || code === 'ENAMETOOLONG') return path;
    // A loop of links on the way, say.
    throw refused;
  }
  if (entry && (!entry.isFile() || realpathSync(path) !== join(realpathSync(root), 'media', name)))
    throw refused;
  return path;
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
  // A name media.json has from before whose file is a link now, or leaves media/, is refused here,
  // whether or not the server has its file: it would go on naming what isn't in the deck.
  // A name with a \ comes from elsewhere on Windows, where it can't be a file: it is left alone
  // here, as one not here, and refused only if it would have to be uploaded.
  for (const name of Object.keys(media))
    if (!(process.platform === 'win32' && name.includes('\\'))) mediaFile(root, name);
  const dir = join(root, 'media');
  for (const path of walk(dir)) {
    // A name with / between its folders, as media.json has it: on Windows, from its \; elsewhere
    // a \ is part of a name.
    const name = relative(dir, path).split(sep).join('/');
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
      type: mediaTypeOf(name),
    };
  }
  mkdirSync(join(root, '.tobos'), { recursive: true });
  writeFileSync(cacheFile, JSON.stringify(cache));
  const sorted = Object.fromEntries(Object.entries(media).sort(([a], [b]) => a.localeCompare(b)));
  const after = formatMediaJson(sorted);
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
  deck: string,
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
    const path = mediaFile(root, name);
    if (!existsSync(path))
      throw new CliError(
        `media/${name} is in media.json but not on this machine, and the server doesn't have it.`,
      );
    note(`uploading media/${name} (${Math.round(entry.size / 1000)} kB)`);
    const response = await request(`/api/media/${hash}?deck=${deck}`, {
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
