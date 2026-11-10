import type { SharedManifest } from '@tobos/deck';
import { describe, expect, it } from 'vitest';
import { contextFor, shownOf } from '../src/viewer/shown.ts';

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

describe('contextFor', () => {
  it('names the chapter a scene is in, and the chapters presenting shows', () => {
    expect(contextFor(deck, 3, true)).toMatchObject({
      chapter: { id: 'three', title: 'Three' },
      scene: { id: 'd' },
      chapters: [{ id: 'one' }, { id: 'three' }],
    });
  });

  it('names no chapter in a deck with none: its one has no id and no title, and none is listed', () => {
    const flat = { ...deck, chapters: [{ id: '', title: '', scenes: [scene('a', ['x'])] }] };
    expect(contextFor(flat, 0)).toEqual({
      title: 'Lecture',
      chapters: [],
      chapter: { id: '', title: '' },
      scene: { id: 'a', title: 'a' },
    });
  });
});
