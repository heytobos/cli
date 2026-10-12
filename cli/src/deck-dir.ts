import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { git } from './git.ts';
import { CliError } from './out.ts';

export interface DeckDir {
  root: string;
  /** "account/deck" on the server, from the git remote. */
  name?: string;
  server?: string;
}

const REMOTE = /^(https?:\/\/[^/]+)\/git\/([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)\.git$/;

/** The deck (or template) this directory is in: the nearest folder with a deck.json. */
export async function findDeck(start = process.cwd()): Promise<DeckDir> {
  let dir = resolve(start);
  while (!existsSync(join(dir, 'deck.json'))) {
    const up = dirname(dir);
    if (up === dir)
      throw new CliError('Not in a deck: no deck.json here or above. `tobos clone` one first.');
    dir = up;
  }
  const remote = await git(['remote', 'get-url', 'origin'], { cwd: dir }).catch(() => undefined);
  const match = remote && remote.code === 0 ? REMOTE.exec(remote.stdout.trim()) : null;
  return match ? { root: dir, server: match[1], name: `${match[2]}/${match[3]}` } : { root: dir };
}

export async function requireRemote(start?: string): Promise<Required<DeckDir>> {
  const deck = await findDeck(start);
  if (!deck.name || !deck.server)
    throw new CliError(
      `${deck.root} isn't linked to a deck on a Tobos server (no matching git remote "origin").`,
    );
  return deck as Required<DeckDir>;
}

export function parseName(name: string): { account: string; deck: string } {
  const match = /^([a-z][a-z0-9-]*)\/([a-z][a-z0-9-]*)$/.exec(name);
  if (!match) throw new CliError(`"${name}" is not a deck name; use account/deck.`);
  return { account: match[1]!, deck: match[2]! };
}
