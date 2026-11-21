/**
 * Following a theme (ADR 0010, D9): a deck's design merged with a version of a theme, file by file,
 * by the record of where the deck's design came from (theme.json, look.ts). Each design file is a
 * key: `master/…` by the sha256 of its bytes, `media/master/…` by its hash in media.json, and a
 * package by its version in deck.json. The deck's own changes always win, a theme file it deleted
 * included, which stays deleted:
 *
 * | The file                                                    | On follow                         |
 * | ----------------------------------------------------------- | --------------------------------- |
 * | unchanged since the theme version the deck has              | replaced                          |
 * | one of the deck's own changes, even if the theme changed it | kept                              |
 * | new in the theme, where the deck has its own file           | the deck's kept, and said so      |
 * | new in the theme                                            | added                             |
 * | gone from the theme, still used                             | kept, as the deck's own           |
 * | gone from the theme, unused                                 | removed                           |
 *
 * Pure: the server reads the files, judges what is still used (usedFromScenes) and saves.
 */
import { sha256 } from './hash.ts';
import { lookRecordOf, type LookRecord } from './look.ts';
import { globMatcher } from './media-pattern.ts';
import type { Master } from './master.ts';
import { resolvePath } from './tree.ts';
import type { MediaEntry, MediaJson } from './types.ts';

/** A deck's design as it is: its master's files, the master's media, and deck.json's packages. */
export interface DeckDesign {
  /** Every file under master/. */
  files: Record<string, Uint8Array>;
  /** media.json's entries under master/, by name (`master/logo.svg`). */
  media: MediaJson;
  /** deck.json's dependencies, all of them: the master's and the deck's own. */
  packages: Record<string, string>;
}

/** What following changes, and what it leaves the deck's own. */
export interface FollowPlan {
  /** Files under master/ to write, or to remove (null). */
  files: Record<string, Uint8Array | null>;
  /** media.json's entries to set, or to remove (null), by name (`master/logo.svg`). */
  media: Record<string, MediaEntry | null>;
  /** deck.json's dependencies to set, or to remove (null). */
  packages: Record<string, string | null>;
  /** By key (`master/…`, `media/master/…`, `package:<name>`): the theme's, put in. */
  replaced: string[];
  added: string[];
  /** The deck's own changes, kept whatever the theme did with them, a deletion among them. */
  kept: string[];
  /** New in the theme where the deck has a file of its own, which it keeps. */
  clashes: string[];
  /** Gone from the theme and unchanged in the deck: removed, unless still used (`used`). */
  gone: string[];
  /**
   * The deck's record from now on: the theme's whole design at its version, and each file the deck
   * deleted that the theme no longer has, by its hash then, so it stays deleted if the theme brings
   * it back.
   */
  record: LookRecord;
}

const PACKAGE = 'package:';

/**
 * The deck's design merged with `theme`'s at version `to`, by the deck's record (undefined for a
 * deck that has none, whose every design file is then its own). `used` says which of the files gone
 * from the theme are still used, by key: those stay, as the deck's own; the rest go.
 */
export function planFollow(
  deck: DeckDesign,
  record: LookRecord | undefined,
  theme: Master,
  to: { theme: string; name: string; version: string },
  used: (key: string) => boolean = () => true,
): FollowPlan {
  const next = lookRecordOf(theme, to);
  const plan: FollowPlan = {
    files: {},
    media: {},
    packages: {},
    replaced: [],
    added: [],
    kept: [],
    clashes: [],
    gone: [],
    record: next,
  };
  const ours = new Map<string, string>();
  for (const [path, bytes] of Object.entries(deck.files)) ours.set(path, sha256(bytes));
  for (const [name, entry] of Object.entries(deck.media)) ours.set(`media/${name}`, entry.hash);
  for (const [name, version] of Object.entries(deck.packages))
    ours.set(`${PACKAGE}${name}`, version);
  const had = new Map<string, string>(Object.entries(record?.files ?? {}));
  for (const [name, version] of Object.entries(record?.packages ?? {}))
    had.set(`${PACKAGE}${name}`, version);
  const theirs = new Map<string, string>(Object.entries(next.files));
  for (const [name, version] of Object.entries(next.packages))
    theirs.set(`${PACKAGE}${name}`, version);

  /** The theme's file at `key` put in, or the deck's taken out (`null`). */
  const put = (key: string, take: boolean) => {
    if (key.startsWith(PACKAGE)) {
      const name = key.slice(PACKAGE.length);
      plan.packages[name] = take ? theme.dependencies[name]! : null;
    } else if (key.startsWith('media/')) {
      const name = key.slice('media/'.length);
      plan.media[name] = take ? theme.media[name]! : null;
    } else plan.files[key] = take ? theme.files[key]! : null;
  };

  for (const key of [...new Set([...ours.keys(), ...had.keys(), ...theirs.keys()])].sort()) {
    // Only the master's packages are design: a package of the deck's own, which neither the theme
    // nor its record names, is none of following's business.
    if (key.startsWith(PACKAGE) && !had.has(key) && !theirs.has(key)) continue;
    const d = ours.get(key);
    const r = had.get(key);
    const t = theirs.get(key);
    if (d !== undefined && d === r) {
      // Unchanged since the theme version the deck has: the theme's now, or gone with it.
      if (t === undefined) {
        if (used(key)) plan.kept.push(key);
        else {
          plan.gone.push(key);
          put(key, false);
        }
      } else if (t !== d) {
        plan.replaced.push(key);
        put(key, true);
      }
    } else if (d !== undefined) {
      // The deck's own: kept, whatever the theme did; a new theme file at its path says so.
      if (r === undefined && t !== undefined && t !== d) plan.clashes.push(key);
      else if (r !== undefined || t === undefined) plan.kept.push(key);
    } else if (r === undefined && t !== undefined) {
      plan.added.push(key);
      put(key, true);
    } else if (r !== undefined && t === undefined) {
      // Deleted by the deck, and gone from the theme: its record keeps it deleted (D9).
      if (key.startsWith(PACKAGE)) next.packages[key.slice(PACKAGE.length)] = r;
      else next.files[key] = r;
    }
    // Deleted by the deck, and still the theme's: it stays deleted, as the record says.
    if (d === undefined && r !== undefined) plan.kept.push(key);
  }
  next.files = sortedEntries(next.files);
  next.packages = sortedEntries(next.packages);
  return plan;
}

/** Specifiers a module imports: `from '…'`, `import '…'`, `import('…')`. */
const IMPORTS =
  /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
/** What `import.meta.glob(…)` is given: a pattern, or a list of them, up to its options. */
const GLOBS = /\bimport\.meta\.glob\s*\(\s*(\[[^\]]*\]|'[^']*'|"[^"]*"|`(?:[^`$]|\$(?!\{))*`)/g;
/** The strings in what a glob is given: a template string's without `${…}` in it. */
const STRINGS = /'([^']*)'|"([^"]*)"|`((?:[^`$]|\$(?!\{))*)`/g;
/** What a stylesheet links: `url(…)`, quoted or not, without the space around it. */
const URLS = /url\(\s*(?:'([^']*)'|"([^"]*)"|([^'")\s]+))\s*\)/g;
const CODE = /\.(svelte|ts|js|mjs|json)$/;

/**
 * Whether a deck's scenes use a design file, as its files say it, by key: a file its scenes reach
 * through their imports, from `scenes/` (and tokens.css, which every page links), by path; media
 * they import, link or glob (`media/master/…`); a package they import (`package:<name>`). Read from
 * the text, not compiled: what a module imports by a name made at run time it doesn't see, so a
 * file gone from a theme that something reaches only so is taken for unused.
 */
export function usedFromScenes(files: Map<string, Uint8Array>): (key: string) => boolean {
  return reachedFrom(
    files,
    [...files.keys()].filter(
      (path) => (path.startsWith('scenes/') && CODE.test(path)) || path === 'master/tokens.css',
    ),
  );
}

/**
 * The scenes of a deck whose look a change of these design files may change, by id (ADR 0010,
 * D7): each that reaches one of `changed` (keys as FollowPlan has them), and every one when the
 * stylesheet every page links, tokens.css, or a file it imports or links changes. Read as usedFromScenes reads.
 */
export function scenesReaching(files: Map<string, Uint8Array>, changed: string[]): string[] {
  const scenes = [...files.keys()].flatMap(
    (path) => /^scenes\/([^/]+)\.svelte$/.exec(path)?.[1] ?? [],
  );
  const linked = reachedFrom(files, ['master/tokens.css']);
  // A package's stylesheet, as tokens.css and all it imports or links, is on every page.
  if (
    changed.some((key) => key === 'master/tokens.css' || key.startsWith('package:') || linked(key))
  )
    return scenes;
  return scenes.filter((id) => {
    const reaches = reachedFrom(files, [`scenes/${id}.svelte`]);
    return changed.some(reaches);
  });
}

/**
 * A URL's path as the file the browser's request names: each part percent-decoded
 * (`font%20styles.css`); a part with a malformed escape, or one that would decode
 * to a separator (`%2F`), as written.
 */
function decodedPath(url: string): string {
  return url
    .split('/')
    .map((part) => {
      try {
        const decoded = decodeURIComponent(part);
        return decoded.includes('/') ? part : decoded;
      } catch {
        return part;
      }
    })
    .join('/');
}

/** Whether what `roots` reach through their imports and links has a key (usedFromScenes). */
function reachedFrom(files: Map<string, Uint8Array>, roots: string[]): (key: string) => boolean {
  const used = new Set<string>();
  const globs: ((key: string) => boolean)[] = [];
  const queue = [...roots];
  while (queue.length) {
    const path = queue.pop()!;
    if (used.has(path)) continue;
    used.add(path);
    const bytes = files.get(path);
    if (!bytes) continue;
    const text = Buffer.from(bytes).toString('utf8');
    for (const given of text.matchAll(GLOBS))
      for (const m of given[1]!.matchAll(STRINGS)) {
        const pattern = m[1] ?? m[2] ?? m[3] ?? '';
        // Matched as the viewer matches a glob over media.json's names (media-pattern.ts).
        if (pattern.startsWith('$media/')) {
          const matches = globMatcher(pattern.slice('$media/'.length));
          globs.push((key) => key.startsWith('media/') && matches(key.slice('media/'.length)));
        }
      }
    const specifiers = [...text.matchAll(IMPORTS)].map((m) => m[1] ?? m[2] ?? m[3]);
    if (path.endsWith('.css'))
      for (const m of text.matchAll(URLS)) {
        // A file by its path: the browser asks for it without its fragment (`#iefix`) and the
        // server serves it whatever its query (`?v=2`).
        const url = (m[1] ?? m[2] ?? m[3]!).replace(/[?#].*$/, '');
        // As written too: the build looks a stylesheet's media up by its name literally.
        for (const name of new Set([url, decodedPath(url)])) {
          const at = resolvePath(path, name);
          // A stylesheet it links (`@import url(…)`) is read for what it links in turn.
          if (at && at.endsWith('.css') && files.has(at)) queue.push(at);
          else if (at) used.add(at);
        }
      }
    for (const specifier of specifiers) {
      if (!specifier) continue;
      if (specifier.startsWith('$media/')) used.add(`media/${specifier.slice('$media/'.length)}`);
      else if (specifier.startsWith('.')) {
        const at = resolvePath(path, specifier);
        if (at && files.has(at)) queue.push(at);
      } else {
        const parts = specifier.split('/');
        const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
        used.add(`${PACKAGE}${name}`);
      }
    }
  }
  return (key) => used.has(key) || globs.some((matches) => matches(key));
}

/** Entries by key, as a new object. */
function sortedEntries(entries: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(entries).sort(([a], [b]) => (a < b ? -1 : 1)));
}
