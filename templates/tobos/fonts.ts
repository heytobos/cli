/**
 * Copy the master's typefaces, tobos.ai's own (all SIL Open Font License, licences included),
 * into a template's media/master/fonts/, and record them in its media.json, as `tobos push`
 * would: this template's, or the one whose folder is given (Tobos simple's build runs it so).
 * What else media.json records stays.
 */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MediaJson } from '@tobos/deck';

const root = resolve(process.argv[2] ?? dirname(fileURLToPath(import.meta.url)));
const source = dirname(fileURLToPath(import.meta.resolve('@tobos/site/fonts.css')));
const files = readdirSync(source).filter((file) => /\.(woff2|txt)$/.test(file));
const dir = join(root, 'media', 'master', 'fonts');
mkdirSync(dir, { recursive: true });
const recorded = join(root, 'media.json');
const media: MediaJson = Object.fromEntries(
  Object.entries(
    (existsSync(recorded) ? JSON.parse(readFileSync(recorded, 'utf8')) : {}) as MediaJson,
  ).filter(([name]) => !name.startsWith('master/fonts/')),
);
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
// Whole or not at all: the next run reads it back for what it keeps.
writeFileSync(`${recorded}.${process.pid}`, JSON.stringify(sorted, null, 2) + '\n');
renameSync(`${recorded}.${process.pid}`, recorded);
console.log(`fonts: ${files.length} files`);
