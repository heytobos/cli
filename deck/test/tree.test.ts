import { describe, expect, it } from 'vitest';
import { isSafePath } from '../src/tree.ts';

describe('isSafePath', () => {
  it('takes the paths a deck holds', () => {
    for (const path of [
      'deck.json',
      'scenes/title.svelte',
      'master/layouts/Content.svelte',
      '.gitignore',
      'data/.hidden/notes.md',
      'lib/a..b.ts',
    ])
      expect(isSafePath(path), path).toBe(true);
  });

  it('refuses a path that leaves the deck or reaches into git', () => {
    for (const path of [
      '/etc/passwd',
      '../outside',
      'data/../../outside',
      'data/./file',
      'data//file',
      'data/',
      '',
      '.git/config',
      'lib/.GIT/HEAD',
      // A NUL ends an entry for git: what follows would be another (writeCommit).
      `unused\u00000 ${'0'.repeat(40)}\ttheme.json`,
    ])
      expect(isSafePath(path), JSON.stringify(path)).toBe(false);
  });
});
