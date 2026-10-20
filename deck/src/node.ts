import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DeckTree } from './types.ts';

/** Never part of a deck's source: media is uploaded separately, the rest is local. */
const SKIP = new Set(['.git', 'node_modules', 'media', 'sources', '.tobos']);

/**
 * A deck in a directory on disk. Given `only`, just those of its files: the CLI passes what git
 * would push (`tobos push` commits what git doesn't ignore), so the check reads what the server
 * will.
 */
export function directoryTree(root: string, only?: Iterable<string>): DeckTree {
  const allowed = only === undefined ? undefined : new Set(only);
  const files: string[] = [];
  const visit = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (prefix === '' && SKIP.has(entry.name)) continue;
      if (entry.name === '.DS_Store' || entry.name === 'node_modules') continue;
      const path = prefix + entry.name;
      if (entry.isDirectory()) visit(join(dir, entry.name), path + '/');
      else if (entry.isFile() && (allowed?.has(path) ?? true)) files.push(path);
    }
  };
  visit(root, '');
  files.sort();
  const listed = new Set(files);
  return {
    files: () => files,
    // Only what was listed: no path can reach outside the folder.
    read: (path) => {
      if (!listed.has(path)) return undefined;
      // A file that is there but can't be read is the check's to report, not to pass over.
      try {
        return new Uint8Array(readFileSync(join(root, path)));
      } catch (error) {
        throw new Error(`${path} can't be read: ${(error as Error).message}`);
      }
    },
  };
}
