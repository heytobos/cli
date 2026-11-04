import type { SharedManifest } from '@tobos/deck';
import { describe, expect, it } from 'vitest';
import { shownOf } from '../src/viewer/shown.ts';

const scene = (id: string, beats: string[], hidden = false) => ({
  id,
  title: id,
  beats,
  module: `@deck/scenes/${id}.svelte`,
  ...(hidden ? { hidden: true as const } : {}),
});
const deck: SharedManifest = {
  format: 1,
  title: 'Lecture',
  chapters: [
    { id: 'one', title: 'One', scenes: [scene('a', ['x']), scene('b', ['x', 'y'], true)] },
    { id: 'two', title: 'Two', scenes: [scene('c', ['x'], true)] },
    { id: 'three', title: 'Three', scenes: [scene('d', ['x', 'y']), scene('e', ['x'], true)] },
  ],
  imports: {},
  media: {},
  dependencies: {},
  packages: {},
};

describe('shownOf', () => {
  it('leaves out the hidden scenes, and a chapter they leave empty', () => {
    expect(shownOf(deck).chapters.map((c) => [c.id, c.scenes.map((s) => s.id)])).toEqual([
      ['one', ['a']],
      ['three', ['d']],
    ]);
  });

  it('is the manifest itself when nothing is hidden', () => {
    const open = shownOf(deck);
    expect(shownOf(open)).toBe(open);
  });
});
