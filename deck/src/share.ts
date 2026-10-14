import type { Manifest } from './types.ts';

/**
 * A revision as a share link shows it to people outside the deck's account: without the scenes
 * that have an activity, since a share never opens a room, and without the scenes' notes, which
 * are for the people working on the deck. A chapter left with no scene goes too.
 */
export function sharedManifest(manifest: Manifest): Manifest {
  return {
    ...manifest,
    chapters: manifest.chapters
      .map((chapter) => ({
        ...chapter,
        scenes: chapter.scenes
          .filter((scene) => !scene.activity)
          .map((scene) => {
            const shown = { ...scene };
            delete shown.note;
            return shown;
          }),
      }))
      .filter((chapter) => chapter.scenes.length > 0),
  };
}
