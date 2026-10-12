/**
 * Copy the master's typefaces, tobos.ai's own (all SIL Open Font License, licences included),
 * into media/master/fonts/, and record them in media.json, as `tobos push` would.
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const source = dirname(fileURLToPath(import.meta.resolve('@tobos/site/fonts.css')));
const files = readdirSync(source).filter((file) => /\.(woff2|txt)$/.test(file));
const dir = join(root, 'media', 'master', 'fonts');
mkdirSync(dir, { recursive: true });
const media: Record<string, { hash: string; size: number; type: string }> = {};
for (const file of files) {
  const target = join(dir, file);
  copyFileSync(join(source, file), target);
  media[`master/fonts/${file}`] = {
    hash: createHash('sha256').update(readFileSync(target)).digest('hex'),
    size: statSync(target).size,
    type: file.endsWith('.txt') ? 'text/plain' : 'font/woff2',
  };
}
const sorted = Object.fromEntries(Object.entries(media).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(join(root, 'media.json'), JSON.stringify(sorted, null, 2) + '\n');
console.log(`fonts: ${files.length} files`);
