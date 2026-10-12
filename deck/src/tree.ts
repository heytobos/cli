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

/** 1-based line and column of an offset in a text. */
export function position(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let last = -1;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      last = i;
    }
  }
  return { line, column: offset - last };
}
