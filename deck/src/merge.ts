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

/**
 * A file both sides changed, merged: deck.json scene by scene (mergeDeckJson), any other text
 * line by line. Undefined for a conflict. The server's `save` and the CLI's `pull` both merge
 * with this.
 */
export function mergeFile(
  path: string,
  base: string,
  ours: string,
  theirs: string,
): string | undefined {
  return path === 'deck.json' ? mergeDeckJson(base, ours, theirs) : mergeText(base, ours, theirs);
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };
interface Chapter extends JsonObject {
  id: string;
  scenes: JsonObject[];
}
type Deck = JsonObject & { chapters: Chapter[] };

const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
/** A value written with its objects' keys sorted: two values alike whatever their keys' order. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_, v: unknown) =>
    isObject(v) ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => (x < y ? -1 : 1))) : v,
  );
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

/**
 * deck.json read for merging: an object whose chapters are listed with their scenes, each by an
 * id it alone has. Undefined otherwise, for lines to merge and the check to judge.
 */
function deckOf(text: string): Deck | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isObject(value) || !Array.isArray(value.chapters)) return undefined;
  const chapters = value.chapters;
  const ok = chapters.every(
    (c) =>
      isObject(c) &&
      typeof c.id === 'string' &&
      Array.isArray(c.scenes) &&
      c.scenes.every((s) => isObject(s) && typeof s.id === 'string'),
  );
  if (!ok) return undefined;
  const deck = value as Deck;
  const ids = [
    deck.chapters.map((c) => c.id),
    deck.chapters.flatMap((c) => c.scenes.map((s) => s.id)),
  ];
  return ids.every((list) => new Set(list).size === list.length) ? deck : undefined;
}

/** Both sides changed one value differently: a true conflict, as lines both changed are. */
class Conflict extends Error {}

/**
 * A value both sides made from `base`, merged: what only one side changed is that side's; an
 * object both changed, key by key; anything else both changed differently, a Conflict.
 * Undefined is a key taken out.
 */
function merged(
  base: Json | undefined,
  ours: Json | undefined,
  theirs: Json | undefined,
): Json | undefined {
  if (same(ours, base)) return theirs;
  if (same(theirs, base) || same(ours, theirs)) return ours;
  if (!isObject(ours) || !isObject(theirs)) throw new Conflict();
  const out: JsonObject = {};
  const old = isObject(base) ? base : {};
  for (const key of new Set([...Object.keys(theirs), ...Object.keys(ours)])) {
    const value = merged(old[key], ours[key], theirs[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * The ids `side` moved from where `base` had them: those out of the longest run still in base's
 * order.
 */
function movedIn(base: string[], side: string[]): Set<string> {
  const kept = side.filter((id) => base.includes(id));
  const at = kept.map((id) => base.indexOf(id));
  // The longest increasing run of base's positions, by patience sorting.
  const tails: number[] = [];
  const before: number[] = [];
  at.forEach((value, i) => {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (at[tails[mid]!]! < value) lo = mid + 1;
      else hi = mid;
    }
    before[i] = lo ? tails[lo - 1]! : -1;
    tails[lo] = i;
  });
  const run = new Set<string>();
  for (let i = tails.at(-1) ?? -1; i >= 0; i = before[i]!) run.add(kept[i]!);
  return new Set(kept.filter((id) => !run.has(id)));
}

/**
 * deck.json changed on both sides, merged: lines first, so the text stays as it was written,
 * if that says what a merge scene by scene says; else scene by scene, written in the file's own
 * indentation. Scene by scene, the server's (`theirs`) order stands, with what the push
 * (`ours`) did to it: scenes it moved, added or took out, by id, each after the scene before it
 * in its chapter, its place winning for a scene both moved; and the keys it changed. A chapter it
 * put a scene in that's gone is made again; a chapter left with none goes. Undefined for a key
 * both changed differently, a true conflict, and where a side isn't deck.json with chapters of
 * scenes and lines conflict.
 */
export function mergeDeckJson(base: string, ours: string, theirs: string): string | undefined {
  const lined = mergeText(base, ours, theirs);
  const [b, o, t] = [deckOf(base), deckOf(ours), deckOf(theirs)];
  if (!b || !o || !t) return lined;
  try {
    return byScene(b, o, t, lined, theirs);
  } catch (error) {
    if (error instanceof Conflict) return undefined;
    throw error;
  }
}

/**
 * `item` into `list` after the nearest of `before` (closest first) that `list` has, or first:
 * where it goes after what the push had before it.
 */
function putAfter<T extends JsonObject>(list: T[], before: (Json | undefined)[], item: T) {
  const at = before.map((id) => list.findIndex((x) => x.id === id)).find((x) => x >= 0);
  list.splice((at ?? -1) + 1, 0, item);
}

/** A chapter's own keys, without its scenes. */
const fieldsOf = ({ scenes: _, ...fields }: Chapter) => fields;

/** mergeDeckJson's merge scene by scene, on the three read: a Conflict where keys conflict. */
function byScene(b: Deck, o: Deck, t: Deck, lined: string | undefined, theirs: string): string {
  const place = (deck: Deck) =>
    new Map(deck.chapters.flatMap((c) => c.scenes.map((s) => [s.id as string, c.id] as const)));
  const order = (deck: Deck) => deck.chapters.flatMap((c) => c.scenes.map((s) => s.id as string));
  const [inBase, inOurs] = [place(b), place(o)];
  const sceneIn = (deck: Deck, id: string) =>
    deck.chapters.flatMap((c) => c.scenes).find((s) => s.id === id);

  // The server's chapters and scenes, to put the push's changes into.
  const chapters: Chapter[] = t.chapters.map((c) => ({ ...c, scenes: [...c.scenes] }));
  const take = (id: string) => {
    for (const c of chapters) {
      const at = c.scenes.findIndex((s) => s.id === id);
      if (at >= 0) return c.scenes.splice(at, 1)[0];
    }
  };

  /** The ids before item `i` of `list`, the nearest first. */
  const before = (list: JsonObject[], i: number) =>
    list
      .slice(0, i)
      .map((x) => x.id)
      .reverse();

  // Taken out by the push.
  for (const id of order(b)) if (!inOurs.has(id)) take(id);

  // Moved or added by the push, in its order, so the scene each follows is in place first.
  const moved = movedIn(order(b), order(o));
  for (const c of o.chapters) {
    c.scenes.forEach((scene, i) => {
      const id = scene.id as string;
      const added = !inBase.has(id);
      const elsewhere = inBase.get(id) !== c.id;
      if (!added && !moved.has(id) && !elsewhere) return;
      // A scene the server took out stays out, unless the push added it.
      const was = take(id);
      if (!was && !added) return;
      let chapter = chapters.find((x) => x.id === c.id);
      if (!chapter) {
        // After the chapter the push has before it, if there is one here.
        chapter = { ...fieldsOf(c), id: c.id, scenes: [] };
        putAfter(chapters, before(o.chapters, o.chapters.indexOf(c)), chapter);
      }
      putAfter(chapter.scenes, before(c.scenes, i), was ?? scene);
    });
  }

  // Chapters the push moved, after the chapter it has before each.
  const movedChapters = movedIn(
    b.chapters.map((c) => c.id),
    o.chapters.map((c) => c.id),
  );
  o.chapters.forEach((c, i) => {
    const at = chapters.findIndex((x) => x.id === c.id);
    if (!movedChapters.has(c.id) || at < 0) return;
    putAfter(chapters, before(o.chapters, i), chapters.splice(at, 1)[0]!);
  });

  // Each scene's and chapter's keys, merged; a chapter left with no scene goes.
  const result = merged(
    { ...b, chapters: null },
    { ...o, chapters: null },
    { ...t, chapters: null },
  ) as JsonObject;
  result.chapters = chapters
    .filter((c) => c.scenes.length > 0)
    .map((c) => {
      const keys = (deck: Deck) => {
        const found = deck.chapters.find((x) => x.id === c.id);
        return found && fieldsOf(found);
      };
      const fields = fieldsOf(c);
      const head = (merged(keys(b), keys(o), keys(t) ?? fields) ?? fields) as JsonObject;
      return {
        ...head,
        scenes: c.scenes.map(
          (s) =>
            (merged(
              sceneIn(b, s.id as string),
              sceneIn(o, s.id as string),
              sceneIn(t, s.id as string) ?? s,
            ) ?? s) as JsonObject,
        ),
      };
    });
  // The keys in the order the server's file has them.
  const ordered: JsonObject = {};
  for (const key of [...Object.keys(t), ...Object.keys(result)])
    if (key in result && !(key in ordered)) ordered[key] = result[key]!;

  if (lined !== undefined) {
    const read = deckOf(lined);
    if (read && same(read, ordered)) return lined;
  }
  const indent = /\n([ \t]+)"/.exec(theirs)?.[1] ?? '';
  const text = indent ? JSON.stringify(ordered, null, indent) : JSON.stringify(ordered);
  return theirs.endsWith('\n') ? `${text}\n` : text;
}
