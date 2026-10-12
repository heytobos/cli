import { describe, expect, it } from 'vitest';
import { carry, cue, formatHash, ordinal, parseHash, step, type Outline } from '../src/position.ts';

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
