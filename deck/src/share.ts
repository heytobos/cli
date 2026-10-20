import type { Manifest } from './types.ts';

/**
 * A revision as a share link shows it to people outside the deck's account: without the scenes
 * that have an activity, since a share never opens a room, nor their modules in the import map,
 * which hold their prompts. A chapter left with no scene goes too. A revision pushed while
 * scenes still had a `note` in deck.json keeps it in its manifest; that was for the people
 * working on the deck, so it goes as well.
 */
export function sharedManifest(manifest: Manifest): Manifest {
  const left = new Set(
    manifest.chapters.flatMap((c) => c.scenes.filter((s) => s.activity).map((s) => s.module)),
  );
  return {
    ...manifest,
    imports: Object.fromEntries(
      Object.entries(manifest.imports).filter(([specifier]) => !left.has(specifier)),
    ),
    chapters: manifest.chapters
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
      .filter((chapter) => chapter.scenes.length > 0),
  };
}

/**
 * Whether a viewer of this manifest may load a compiled module (`m/<hash>.js` or `.css`): one
 * its import map or its stylesheets name, and no other the deck ever had.
 */
export function servesModule(manifest: Manifest, path: string): boolean {
  return Object.values(manifest.imports).includes(path) || (manifest.styles ?? []).includes(path);
}
