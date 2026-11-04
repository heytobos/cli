import { describe, expect, it } from 'vitest';
import {
  carry,
  cue,
  firstShown,
  formatHash,
  ordinal,
  parseHash,
  shownCount,
  shownFrom,
  shownOrdinal,
  step,
  type Outline,
} from '../src/position.ts';

const outline: Outline = {
  scenes: [
    { id: 'title', beats: ['title'] },
    { id: 'question', beats: ['scan', 'ask', 'answer'] },
    { id: 'tokens', beats: ['text', 'ids'] },
  ],
};

describe('stepping', () => {
  it('crosses scene boundaries', () => {
    expect(step(outline, { scene: 0, beat: 0 }, 1)).toEqual({ scene: 1, beat: 0 });
    expect(step(outline, { scene: 1, beat: 0 }, -1)).toEqual({ scene: 0, beat: 0 });
    expect(step(outline, { scene: 1, beat: 2 }, 1)).toEqual({ scene: 2, beat: 0 });
  });

  it('stops at both ends', () => {
    expect(step(outline, { scene: 0, beat: 0 }, -1)).toEqual({ scene: 0, beat: 0 });
    expect(step(outline, { scene: 2, beat: 1 }, 1)).toEqual({ scene: 2, beat: 1 });
  });
});

describe('cues', () => {
  it('animate a single step forward, including into the next scene', () => {
    expect(cue(outline, { scene: 1, beat: 0 }, { scene: 1, beat: 1 }).animate).toBe(true);
    expect(cue(outline, { scene: 1, beat: 2 }, { scene: 2, beat: 0 }).animate).toBe(true);
  });

  it('land on the end state for back, jumps and loads', () => {
    expect(cue(outline, { scene: 1, beat: 1 }, { scene: 1, beat: 0 }).animate).toBe(false);
    expect(cue(outline, { scene: 0, beat: 0 }, { scene: 1, beat: 1 }).animate).toBe(false);
    expect(cue(outline, null, { scene: 0, beat: 0 }).animate).toBe(false);
  });
});

describe('hashes', () => {
  it('read every form', () => {
    expect(parseHash(outline, '#question/ask')).toEqual({ scene: 1, beat: 1 });
    expect(parseHash(outline, '#question/2')).toEqual({ scene: 1, beat: 2 });
    expect(parseHash(outline, '#tokens')).toEqual({ scene: 2, beat: 0 });
  });

  it('reject what does not exist', () => {
    for (const hash of ['', '#', '#nope', '#question/nope', '#question/3'])
      expect(parseHash(outline, hash)).toBeUndefined();
  });

  it('reject a malformed escape instead of throwing', () => {
    for (const hash of ['#%', '#intro/%E0']) expect(parseHash(outline, hash)).toBeUndefined();
  });

  it('round-trip', () => {
    for (let n = 0; n < 6; n++) {
      const position = step(outline, { scene: 0, beat: 0 }, n);
      expect(parseHash(outline, formatHash(outline, position))).toEqual(position);
      expect(ordinal(outline, position)).toBe(n);
    }
  });
});

describe('carrying a position into a changed deck', () => {
  it('follows the beat by ID', () => {
    const changed: Outline = {
      scenes: [outline.scenes[1]!, { id: 'new', beats: ['a'] }, outline.scenes[2]!],
    };
    expect(carry(outline, changed, { scene: 2, beat: 1 })).toEqual({ scene: 2, beat: 1 });
    expect(carry(outline, changed, { scene: 1, beat: 2 })).toEqual({ scene: 0, beat: 2 });
  });

  it('keeps the scene when the beat is gone', () => {
    const changed: Outline = {
      scenes: [outline.scenes[0]!, { id: 'question', beats: ['scan'] }, outline.scenes[2]!],
    };
    expect(carry(outline, changed, { scene: 1, beat: 2 })).toEqual({ scene: 1, beat: 0 });
  });
});

describe('presenting, with hidden scenes', () => {
  const show: Outline = {
    scenes: [
      { id: 'backup', beats: ['x'], hidden: true },
      { id: 'a', beats: ['x'] },
      { id: 'b', beats: ['x', 'y'], hidden: true },
      { id: 'c', beats: ['x'], hidden: true },
      { id: 'd', beats: ['x', 'y'] },
      { id: 'e', beats: ['x'], hidden: true },
    ],
  };

  it('steps over them', () => {
    expect(step(show, { scene: 1, beat: 0 }, 1)).toEqual({ scene: 4, beat: 0 });
    expect(step(show, { scene: 4, beat: 0 }, -1)).toEqual({ scene: 1, beat: 0 });
    expect(step(show, { scene: 4, beat: 1 }, 1)).toEqual({ scene: 4, beat: 1 });
    expect(step(show, { scene: 1, beat: 0 }, -1)).toEqual({ scene: 1, beat: 0 });
  });

  it('steps through the beats of one gone to, then on to a scene that shows', () => {
    expect(step(show, { scene: 2, beat: 0 }, 1)).toEqual({ scene: 2, beat: 1 });
    expect(step(show, { scene: 2, beat: 1 }, 1)).toEqual({ scene: 4, beat: 0 });
    expect(step(show, { scene: 2, beat: 0 }, -1)).toEqual({ scene: 1, beat: 0 });
    expect(step(show, { scene: 5, beat: 0 }, -1)).toEqual({ scene: 4, beat: 1 });
    expect(step(show, { scene: 5, beat: 0 }, 1)).toEqual({ scene: 5, beat: 0 });
  });

  it('animates the step over them', () => {
    expect(cue(show, { scene: 1, beat: 0 }, { scene: 4, beat: 0 }).animate).toBe(true);
    expect(cue(show, { scene: 1, beat: 0 }, { scene: 2, beat: 0 }).animate).toBe(false);
    expect(cue(show, { scene: 4, beat: 1 }, { scene: 4, beat: 1 }).animate).toBe(false);
  });

  it('starts at the first scene that shows', () => {
    expect(firstShown(show)).toEqual({ scene: 1, beat: 0 });
    expect(firstShown(outline)).toEqual({ scene: 0, beat: 0 });
  });

  it('begins at the next scene that shows when started on a hidden one', () => {
    expect(shownFrom(show, { scene: 2, beat: 1 })).toEqual({ scene: 4, beat: 0 });
    expect(shownFrom(show, { scene: 3, beat: 0 })).toEqual({ scene: 4, beat: 0 });
    expect(shownFrom(show, { scene: 4, beat: 1 })).toEqual({ scene: 4, beat: 1 });
  });

  it('begins at the end of the last scene that shows after the last hidden one', () => {
    expect(shownFrom(show, { scene: 5, beat: 0 })).toEqual({ scene: 4, beat: 1 });
  });

  it('counts only the beats it steps through', () => {
    expect(shownCount(show)).toBe(3);
    expect(shownOrdinal(show, { scene: 1, beat: 0 })).toBe(0);
    expect(shownOrdinal(show, { scene: 4, beat: 1 })).toBe(2);
    expect(shownOrdinal(show, { scene: 2, beat: 1 })).toBeUndefined();
  });
});
