/**
 * A text file changed on two sides since a version both started from, merged line by line, three
 * ways (ADR 0005): what only one side changed is that side's, a change both made alike is made
 * once, and lines both changed differently, or lines both added at one place differently, are a
 * conflict. The one merge: the server's `write`, and the CLI's `pull`.
 */

/** What a side made of the base's lines `[from, to)`: the lines in their place. */
interface Hunk {
  from: number;
  to: number;
  lines: string[];
}

/**
 * The most cells the table of a side's changes may have, its changed lines by the base's: past
 * it, after the lines both keep at the start and the end, a merge is a conflict, to read again.
 */
const MOST = 4_000_000;

/** `ours` and `theirs`, both made from `base`, as one text; undefined for a conflict. */
export function mergeText(base: string, ours: string, theirs: string): string | undefined {
  if (ours === theirs || theirs === base) return ours;
  if (ours === base) return theirs;
  const [b, o, t] = [base, ours, theirs].map(split) as [string[], string[], string[]];
  let changes: [Hunk[], Hunk[]];
  try {
    changes = [hunksOf(b, o), hunksOf(b, t)];
  } catch (error) {
    if (error instanceof TooLarge) return undefined;
    throw error;
  }
  const hunks = [
    ...changes[0].map((h) => ({ ...h, side: 0 })),
    ...changes[1].map((h) => ({ ...h, side: 1 })),
  ].sort((x, y) => x.from - y.from || x.to - y.to);
  const merged: string[] = [];
  let at = 0;
  for (let i = 0; i < hunks.length;) {
    // The hunks that overlap or meet at one place, from either side, go together.
    const group = [hunks[i]!];
    let to = hunks[i]!.to;
    for (i++; i < hunks.length && overlaps(hunks[i]!, group.at(-1)!.from, to); i++) {
      group.push(hunks[i]!);
      to = Math.max(to, hunks[i]!.to);
    }
    const from = group[0]!.from;
    const sides = new Set(group.map((h) => h.side));
    let lines: string[];
    if (sides.size === 1) lines = applied(b, group, from, to);
    else {
      // Both sides changed this stretch: alike, it is one change; otherwise a conflict.
      const mine = applied(
        b,
        group.filter((h) => h.side === 0),
        from,
        to,
      );
      const yours = applied(
        b,
        group.filter((h) => h.side === 1),
        from,
        to,
      );
      if (mine.join('') !== yours.join('')) return undefined;
      lines = mine;
    }
    merged.push(...b.slice(at, from), ...lines);
    at = to;
  }
  merged.push(...b.slice(at));
  return merged.join('');
}

/** Whether a hunk touches the stretch `[from, to)`: overlapping it, or added at the same place. */
function overlaps(hunk: Hunk, from: number, to: number): boolean {
  return (
    hunk.from < to || hunk.from === from || (hunk.from === to && (hunk.to === to || from === to))
  );
}

/** The base's lines `[from, to)` with a side's hunks in them made. */
function applied(base: string[], hunks: Hunk[], from: number, to: number): string[] {
  const out: string[] = [];
  let at = from;
  for (const hunk of hunks) {
    out.push(...base.slice(at, hunk.from), ...hunk.lines);
    at = hunk.to;
  }
  out.push(...base.slice(at, to));
  return out;
}

/** A text's lines, each with its end, the last without one if the text has none. */
function split(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

/**
 * What changed from `a` to `b`, as stretches of `a` and what took their place: the lines both
 * keep at the start and the end aside, the rest by their longest common subsequence.
 */
function hunksOf(all: string[], other: string[]): Hunk[] {
  let start = 0;
  while (start < all.length && start < other.length && all[start] === other[start]) start++;
  let end = 0;
  while (
    end < all.length - start &&
    end < other.length - start &&
    all[all.length - 1 - end] === other[other.length - 1 - end]
  )
    end++;
  const a = all.slice(start, all.length - end);
  const b = other.slice(start, other.length - end);
  if ((a.length + 1) * (b.length + 1) > MOST) throw new TooLarge();
  return middleHunks(a, b).map((h) => ({ ...h, from: h.from + start, to: h.to + start }));
}

/** A merge too large to make here. */
class TooLarge extends Error {}

/** What changed from `a` to `b`, by their longest common subsequence. */
function middleHunks(a: string[], b: string[]): Hunk[] {
  // The longest common subsequence, by the lengths of the common tails.
  const width = b.length + 1;
  const tail = new Int32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      tail[i * width + j] =
        a[i] === b[j]
          ? tail[(i + 1) * width + j + 1]! + 1
          : Math.max(tail[(i + 1) * width + j]!, tail[i * width + j + 1]!);
  const hunks: Hunk[] = [];
  let [i, j] = [0, 0];
  let open: Hunk | undefined;
  const close = () => {
    if (open) hunks.push(open);
    open = undefined;
  };
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      close();
      i++;
      j++;
    } else if (
      j < b.length &&
      (i === a.length || tail[i * width + j + 1]! >= tail[(i + 1) * width + j]!)
    ) {
      open ??= { from: i, to: i, lines: [] };
      open.lines.push(b[j++]!);
    } else {
      open ??= { from: i, to: i, lines: [] };
      open.to = ++i;
    }
  }
  close();
  return hunks;
}
