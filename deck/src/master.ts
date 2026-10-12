import { parseMediaJson } from './deck-json.ts';
import { readText } from './tree.ts';
import type { DeckTree, MediaJson } from './types.ts';

/**
 * A deck's slide master, to copy into another deck: every file under master/, and the media
 * under media/master/ (its fonts, a logo), as media.json entries.
 */
export function masterOf(tree: DeckTree): { files: Record<string, Uint8Array>; media: MediaJson } {
  const files: Record<string, Uint8Array> = {};
  for (const path of tree.files()) if (path.startsWith('master/')) files[path] = tree.read(path)!;
  const { media: all } = parseMediaJson(readText(tree, 'media.json'));
  const media = Object.fromEntries(
    Object.entries(all).filter(([name]) => name.startsWith('master/')),
  );
  return { files, media };
}
