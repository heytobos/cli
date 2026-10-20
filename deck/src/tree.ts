import type { DeckTree } from './types.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A deck held in memory: for tests, and for trees assembled from elsewhere. */
export function memoryTree(files: Record<string, string | Uint8Array>): DeckTree {
  const map = new Map<string, Uint8Array>();
  for (const [path, content] of Object.entries(files)) {
    map.set(path, typeof content === 'string' ? encoder.encode(content) : content);
  }
  return {
    files: () => [...map.keys()].sort(),
    read: (path) => map.get(path),
  };
}

export function readText(tree: DeckTree, path: string): string | undefined {
  const bytes = tree.read(path);
  return bytes === undefined ? undefined : decoder.decode(bytes);
}

/**
 * Whether a file's path is one a deck can hold: relative, with no empty, `.` or `..` part, and
 * nothing inside a `.git` folder. Git stores whatever names a pushed tree gives, and the server
 * writes a tree's files to disk when it starts a deck from it, so every such write needs this.
 */
export function isSafePath(path: string): boolean {
  return path
    .split('/')
    .every((part) => part !== '' && part !== '.' && part !== '..' && part.toLowerCase() !== '.git');
}

/** Resolve `spec` relative to the file `from`. Returns undefined if it leaves the deck. */
export function resolvePath(from: string, spec: string): string | undefined {
  const parts = from.split('/').slice(0, -1);
  for (const part of spec.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') {
      if (parts.length === 0) return undefined;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join('/');
}

/** Where each line of the last text asked about starts: problems come many to a file. */
let lines: { text: string; starts: number[] } | undefined;

/**
 * 1-based line and column of an offset in a text. A file can have a problem on every line, so
 * each line's start is found once per text, and each offset's line by a binary search.
 */
export function position(text: string, offset: number): { line: number; column: number } {
  if (lines?.text !== text) {
    const starts = [0];
    for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
    lines = { text, starts };
  }
  const { starts } = lines;
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid]! <= offset) low = mid;
    else high = mid - 1;
  }
  return { line: low + 1, column: offset - starts[low]! + 1 };
}
