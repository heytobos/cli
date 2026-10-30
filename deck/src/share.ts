import { mediaMatching } from './media-pattern.ts';
import type { Manifest, MediaJson, Uses } from './types.ts';

const DECK_PREFIX = '@deck/';
const MASTER_PREFIX = `${DECK_PREFIX}master/`;

/**
 * A revision as a share link shows it to people outside the deck's account: without the scenes
 * that have an activity, since a share never opens a room. A chapter left with no scene goes too.
 * A revision pushed while scenes still had a `note` in deck.json keeps it in its manifest; that
 * was for the people working on the deck, so it goes as well.
 *
 * What the scenes it leaves out are made of goes with them: a share gets the deck's modules and
 * media the scenes it shows reach (their own code, what it imports, the master's, and the files
 * it imports of media/), and the files tokens.css links. So neither a poll's helpers nor a
 * draft scene deck.json doesn't list, nor a file in media.json that nothing shows, reaches it. A
 * file the build didn't see a scene use isn't there: it shows as missing, never as more than the
 * scenes.
 */
export function sharedManifest(manifest: Manifest): Manifest {
  const { uses, ...rest } = manifest;
  const chapters = manifest.chapters
    .map((chapter) => ({
      ...chapter,
      scenes: chapter.scenes
        .filter((scene) => !scene.activity)
        .map((scene) => {
          const shown: typeof scene & { note?: string } = { ...scene };
          delete shown.note;
          return shown;
        }),
    }))
    .filter((chapter) => chapter.scenes.length > 0);

  // A manifest pushed before the build recorded what its modules use has nothing to walk. It is
  // shared as it was then, until the deck's next push: without the left-out scenes' own modules,
  // which hold their prompts, and everything else. No revision is rebuilt for it.
  if (!uses) {
    const left = new Set(
      manifest.chapters.flatMap((c) => c.scenes.filter((s) => s.activity).map((s) => s.module)),
    );
    return {
      ...rest,
      imports: Object.fromEntries(
        Object.entries(manifest.imports).filter(([specifier]) => !left.has(specifier)),
      ),
      chapters,
    };
  }

  const { reached, media } = walk(
    manifest,
    uses,
    chapters.flatMap((c) => c.scenes.map((s) => s.module)),
  );
  return {
    ...rest,
    // The packages the server bundled stay: they are npm's, not the deck's.
    imports: Object.fromEntries(
      Object.entries(manifest.imports).filter(
        ([specifier]) => !specifier.startsWith(DECK_PREFIX) || reached.has(specifier),
      ),
    ),
    media: Object.fromEntries(Object.entries(manifest.media).filter(([name]) => media.has(name))),
    chapters,
  };
}

/**
 * The media a revision has in use, which alone counts toward its account's plan and must be on the
 * server for it to be saved (TOB-369): the files the scenes deck.json lists import, through all
 * they import, polls' too; those the master's modules import, and its own files under
 * media/master/, which come and go with it (masterOf), its fonts' licences among them; and those
 * tokens.css links. Media is imported by literal names and patterns, so this is exact. Every other
 * entry of media.json is on no slide: the server keeps its file for a while, and may have deleted
 * it. A manifest pushed before the build recorded what its modules use has it all in use, as it
 * counted then.
 */
export function mediaInUse(
  manifest: Pick<Manifest, 'format' | 'chapters' | 'media' | 'uses'>,
): MediaJson {
  const { uses } = manifest;
  if (!uses) return manifest.media;
  const roots = [
    ...manifest.chapters.flatMap((c) => c.scenes.map((s) => s.module)),
    ...Object.keys(uses.modules).filter((specifier) => specifier.startsWith(MASTER_PREFIX)),
  ];
  const { media } = walk(manifest, uses, roots);
  return Object.fromEntries(
    Object.entries(manifest.media).filter(
      ([name]) => media.has(name) || name.startsWith('master/'),
    ),
  );
}

/**
 * The deck's modules `roots` reach through their imports, and the media.json names they and
 * tokens.css name. A pattern is every name it matches: matched here, each pattern once, so the
 * manifest holds it once rather than every name in every module that writes it. A manifest of
 * format 1 has media()'s patterns, whose `*` matches `/` too; a later one its globs'.
 */
function walk(
  manifest: Pick<Manifest, 'format' | 'media'>,
  uses: Uses,
  roots: string[],
): { reached: Set<string>; media: Set<string> } {
  const reached = new Set<string>();
  const media = new Set(uses.styles);
  const patterns = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const specifier = queue.pop()!;
    if (reached.has(specifier)) continue;
    reached.add(specifier);
    const used = Object.hasOwn(uses.modules, specifier) ? uses.modules[specifier] : undefined;
    queue.push(...(used?.imports ?? []));
    for (const name of used?.media ?? []) media.add(name);
    for (const pattern of used?.patterns ?? []) patterns.add(pattern);
  }
  const named = Object.keys(manifest.media).filter((name) => !media.has(name));
  for (const name of mediaMatching(named, patterns, manifest.format !== 1)) media.add(name);
  return { reached, media };
}

/**
 * Whether a viewer of this manifest may load a compiled module (`m/<hash>.js` or `.css`): one
 * its import map or its stylesheets name, and no other the deck ever had.
 */
export function servesModule(manifest: Manifest, path: string): boolean {
  return Object.values(manifest.imports).includes(path) || (manifest.styles ?? []).includes(path);
}
