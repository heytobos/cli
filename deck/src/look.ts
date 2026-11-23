/**
 * Where a deck's look came from: `theme.json`, which Tobos writes, as it writes media.json, and no
 * write may set. It names the deck or theme the design was taken from, that one's version and its
 * name then, and the hash of each design file taken: a `master/` file by the sha256 of its bytes, a
 * file in `media/master/` by its hash in media.json, a package the master imports by its version.
 * The hashes tell the deck's own changes from what it took, without the theme, so the record means
 * the same after the theme is gone.
 */
import { sha256 } from './hash.ts';
import type { Master } from './master.ts';
import { readText } from './tree.ts';
import type { DeckTree } from './types.ts';

/** The file the record is, at a deck's root. */
export const LOOK_FILE = 'theme.json';

/** Where a deck's look came from, as theme.json has it. */
export interface LookRecord {
  /** The id of the deck or theme its design came from. */
  theme: string;
  /** Its name when the design was taken. */
  name: string;
  /** Its version (`rev`) the design was taken at. */
  version: string;
  /**
   * Each design file taken, by its path in the deck: `master/…` by the sha256 of its bytes,
   * `media/master/…` by its hash in media.json.
   */
  files: Record<string, string>;
  /** Each package the master imported, by the version deck.json gave it. */
  packages: Record<string, string>;
}

/** The record of a design taken from `from` at `version`: its master, its media and packages. */
export function lookRecordOf(
  master: Master,
  from: { theme: string; name: string; version: string },
): LookRecord {
  const files: Record<string, string> = {};
  for (const [path, bytes] of Object.entries(master.files)) files[path] = sha256(bytes);
  for (const [name, entry] of Object.entries(master.media)) files[`media/${name}`] = entry.hash;
  return {
    theme: from.theme,
    name: from.name,
    version: from.version,
    files: sorted(files),
    packages: sorted(master.dependencies),
  };
}

/** theme.json as Tobos writes it: two spaces, keys in order, a line at the end. */
export function formatLookRecord(record: LookRecord): string {
  const { theme, name, version, files, packages } = record;
  return (
    JSON.stringify(
      { theme, name, version, files: sorted(files), packages: sorted(packages) },
      null,
      2,
    ) + '\n'
  );
}

/** A deck's record, if it has one Tobos could have written; undefined if not. */
export function lookRecordIn(tree: DeckTree): LookRecord | undefined {
  return parseLookRecord(readText(tree, LOOK_FILE));
}

/** theme.json's text read, or undefined for none, or one that isn't the record. */
export function parseLookRecord(text: string | undefined): LookRecord | undefined {
  if (text === undefined) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const { theme, name, version, files, packages } = raw as Record<string, unknown>;
  if (typeof theme !== 'string' || typeof name !== 'string' || typeof version !== 'string')
    return undefined;
  if (!isStrings(files) || !isStrings(packages)) return undefined;
  return { theme, name, version, files, packages };
}

const isStrings = (value: unknown): value is Record<string, string> =>
  typeof value === 'object' &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((v) => typeof v === 'string');

/** Entries by key, as a new object: a file may be called __proto__, so none is assigned. */
function sorted(entries: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(entries).sort(([a], [b]) => (a < b ? -1 : 1)));
}
