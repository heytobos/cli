import { describe, expect, it } from 'vitest';
import { mergeText } from '../src/merge.ts';

const lines = (...l: string[]) => l.map((x) => `${x}\n`).join('');

describe('merging a text file three ways, line by line', () => {
  const base = lines('a', 'b', 'c', 'd', 'e');

  it('takes the side that changed, when only one did', () => {
    expect(mergeText(base, base, base)).toBe(base);
    expect(mergeText(base, lines('a', 'B', 'c', 'd', 'e'), base)).toBe(
      lines('a', 'B', 'c', 'd', 'e'),
    );
    expect(mergeText(base, base, lines('a', 'b', 'c', 'd'))).toBe(lines('a', 'b', 'c', 'd'));
  });

  it('keeps both sides’ changes to different lines', () => {
    expect(mergeText(base, lines('A', 'b', 'c', 'd', 'e'), lines('a', 'b', 'c', 'd', 'E'))).toBe(
      lines('A', 'b', 'c', 'd', 'E'),
    );
    // Lines added at different places, and one removed.
    expect(
      mergeText(base, lines('a', 'a2', 'b', 'c', 'd', 'e'), lines('a', 'b', 'c', 'e', 'f')),
    ).toBe(lines('a', 'a2', 'b', 'c', 'e', 'f'));
  });

  it('takes the same change made on both sides once', () => {
    const both = lines('a', 'b', 'C', 'd', 'e');
    expect(mergeText(base, both, both)).toBe(both);
  });

  it('refuses lines both sides changed differently: a true conflict', () => {
    expect(mergeText(base, lines('a', 'b', 'X', 'd', 'e'), lines('a', 'b', 'Y', 'd', 'e'))).toBe(
      undefined,
    );
    // Both added different lines at the same place.
    expect(
      mergeText(base, lines('a', 'x', 'b', 'c', 'd', 'e'), lines('a', 'y', 'b', 'c', 'd', 'e')),
    ).toBe(undefined);
  });

  it('merges files without a last newline, and empty ones', () => {
    expect(mergeText('a\nb', 'A\nb', 'a\nB')).toBe('A\nB');
    expect(mergeText('', 'x\n', '')).toBe('x\n');
    expect(mergeText('', 'x\n', 'y\n')).toBe(undefined);
  });
});

describe('a merge too large to make', () => {
  it('is a conflict, made quickly, where the lines both keep around the change are many', () => {
    const many = Array.from({ length: 50_000 }, (_, i) => `line ${i}\n`);
    const base = many.join('');
    const ours = ['changed\n', ...many.slice(1)].join('');
    const theirs = [...many.slice(0, -1), 'changed too\n'].join('');
    const started = Date.now();
    expect(mergeText(base, ours, theirs)).toBe(
      ['changed\n', ...many.slice(1, -1), 'changed too\n'].join(''),
    );
    const everywhere = many.map((l, i) => (i % 2 ? l : `x${l}`)).join('');
    const elsewhere = many.map((l, i) => (i % 2 ? `y${l}` : l)).join('');
    expect(mergeText(base, everywhere, elsewhere)).toBe(undefined);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
