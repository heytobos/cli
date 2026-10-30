/**
 * Patterns over the names in media.json, which the check, a share and the viewer's
 * `import.meta.glob` each match the same way. The deck writes both pattern and names, so no
 * regex: each part is found leftmost in turn, which never backtracks.
 */

/**
 * Whether a pattern of format 1, a media() template literal's (`cow/*.png`), matches a name: `*`
 * matches anything, `/` too, the rest literally. Within a folder's name it is also a glob's `*`.
 * The pattern is split once, for the many names it is matched against.
 */
export function mediaMatcher(pattern: string): (name: string) => boolean {
  const parts = pattern.split('*');
  if (parts.length === 1) return (name) => name === pattern;
  const first = parts[0]!;
  const last = parts.at(-1)!;
  const middle = parts.slice(1, -1);
  return (name) => {
    const end = name.length - last.length;
    if (end < first.length || !name.startsWith(first) || !name.endsWith(last)) return false;
    let at = first.length;
    for (const part of middle) {
      at = name.indexOf(part, at);
      if (at < 0 || at + part.length > end) return false;
      at += part.length;
    }
    return true;
  };
}

/**
 * Whether an `import.meta.glob` pattern, without its `$media/` (`cow/*.png`), matches a name, as
 * Vite's do: `*` matches within a folder's name, a `**` folder any number of folders, none too.
 * Its runs of folders between `**`s are found as mediaMatcher finds its parts.
 */
export function globMatcher(pattern: string): (name: string) => boolean {
  const runs: ((segment: string) => boolean)[][] = [[]];
  for (const segment of pattern.split('/'))
    if (segment === '**') runs.push([]);
    else runs.at(-1)!.push(mediaMatcher(segment));
  const fits = (run: ((segment: string) => boolean)[], segments: string[], at: number) =>
    run.every((matches, i) => matches(segments[at + i]!));
  const first = runs[0]!;
  if (runs.length === 1)
    return (name) => {
      const segments = name.split('/');
      return segments.length === first.length && fits(first, segments, 0);
    };
  const last = runs.at(-1)!;
  const middle = runs.slice(1, -1);
  return (name) => {
    const segments = name.split('/');
    const end = segments.length - last.length;
    if (end < first.length || !fits(first, segments, 0) || !fits(last, segments, end)) return false;
    let at = first.length;
    for (const run of middle) {
      while (at + run.length <= end && !fits(run, segments, at)) at++;
      if (at + run.length > end) return false;
      at += run.length;
    }
    return true;
  };
}

export const mediaMatches = (pattern: string, name: string): boolean => mediaMatcher(pattern)(name);

/**
 * The names that any of `patterns` matches, globs' or, in a manifest of format 1, media()'s: each
 * pattern matched once, however many modules write it, and one that matches every name (`**`,
 * ``media(`${name}`)``) not matched at all.
 */
export function mediaMatching(
  names: string[],
  patterns: Iterable<string>,
  glob: boolean,
): string[] {
  const distinct = [...new Set(patterns)];
  if (distinct.length === 0) return [];
  if (distinct.some((pattern) => (glob ? pattern === '**' : /^\*+$/.test(pattern)))) return names;
  const matchers = distinct.map(glob ? globMatcher : mediaMatcher);
  return names.filter((name) => matchers.some((matches) => matches(name)));
}
