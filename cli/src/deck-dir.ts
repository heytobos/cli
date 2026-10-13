import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { git } from './git.ts';
import { CliError } from './out.ts';

export interface DeckDir {
  root: string;
  /** The deck's id on the server, from the git remote. */
  id?: string;
  server?: string;
}

const ID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const REMOTE = new RegExp(`^(https?://[^/]+)/git/(${ID})\\.git$`);

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
  return match ? { root: dir, server: match[1], id: match[2] } : { root: dir };
}

export async function requireRemote(start?: string): Promise<Required<DeckDir>> {
  const deck = await findDeck(start);
  if (!deck.id || !deck.server)
    throw new CliError(
      `${deck.root} isn't linked to a deck on a Tobos server (no matching git remote "origin").`,
    );
  return deck as Required<DeckDir>;
}

/** A deck's id, as the command line gives it. */
export function parseId(id: string): string {
  if (!new RegExp(`^${ID}$`).test(id))
    throw new CliError(`"${id}" is not a deck's id; \`tobos decks\` lists them.`);
  return id;
}
