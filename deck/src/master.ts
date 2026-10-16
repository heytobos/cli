import { masterDependencies } from './build.ts';
import { parseMediaJson } from './deck-json.ts';
import { readText } from './tree.ts';
import type { DeckTree, MediaJson } from './types.ts';

/** A deck's slide master, to copy into another deck. */
export interface Master {
  /** Every file under master/. */
  files: Record<string, Uint8Array>;
  /** The media under media/master/ (its fonts, a logo), as media.json entries. */
  media: MediaJson;
  /** The packages it imports, as deck.json dependencies. */
  dependencies: Record<string, string>;
}

/** A deck's master and what it brings: its files, its media and the packages it imports. */
export async function masterOf(tree: DeckTree): Promise<Master> {
  const files: Record<string, Uint8Array> = {};
  for (const path of tree.files()) if (path.startsWith('master/')) files[path] = tree.read(path)!;
  const { media: all } = parseMediaJson(readText(tree, 'media.json'));
  const media = Object.fromEntries(
    Object.entries(all).filter(([name]) => name.startsWith('master/')),
  );
  return { files, media, dependencies: await masterDependencies(tree) };
}
