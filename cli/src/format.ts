import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { request } from './api.ts';
import { CliError } from './out.ts';

/**
 * The format guide, as this server has it, in the working copy's .tobos/ (which git ignores).
 * Everything else an agent needs is in the deck itself: its master, and the master's guide.
 */
export async function writeFormatGuide(root: string, server: string): Promise<void> {
  const dir = join(root, '.tobos');
  mkdirSync(dir, { recursive: true });
  const format = await request('/api/format', { anonymous: true, server });
  if (!format.ok)
    throw new CliError(`Couldn't fetch the format guide from ${server} (${format.status}).`);
  writeFileSync(join(dir, 'FORMAT.md'), await format.text());
}
