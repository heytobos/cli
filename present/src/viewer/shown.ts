import type { SharedManifest } from '@tobos/deck';
import { NO_CHAPTER } from '@tobos/deck/deck-json';
import type { DeckContext } from '../index.ts';

/**
 * The deck as presenting steps through it, and an agenda lists it: without the scenes deck.json
 * hides from the audience, and without a chapter they leave empty. deck.json always has a scene
 * that shows.
 */
export function shownOf<M extends SharedManifest>(manifest: M): M {
  if (!manifest.chapters.some((c) => c.scenes.some((s) => s.hidden))) return manifest;
  return {
    ...manifest,
    chapters: manifest.chapters
      .map((c) => ({ ...c, scenes: c.scenes.filter((s) => !s.hidden) }))
      .filter((c) => c.scenes.length > 0),
  };
}

/**
 * Where scene `index` sits in the deck. `presenting`, a scene that shows lists the chapters
 * presenting shows, as an agenda does; a hidden one, gone to, is as on the deck's page. In a deck
 * with no chapters, its chapter has no id and no title, and none is listed: a wayfinder, a section
 * and an agenda name none.
 */
export function contextFor(
  manifest: SharedManifest,
  index: number,
  presenting = false,
): DeckContext {
  let n = 0;
  for (const chapter of manifest.chapters)
    for (const scene of chapter.scenes) {
      if (n++ !== index) continue;
      const listed = presenting && !scene.hidden ? shownOf(manifest) : manifest;
      return {
        title: manifest.title,
        chapters: listed.chapters
          .filter((c) => c.id !== NO_CHAPTER)
          .map((c) => ({
            id: c.id,
            title: c.title,
            scenes: c.scenes.map((s) => ({ id: s.id, title: s.title })),
          })),
        chapter: { id: chapter.id, title: chapter.title },
        scene: { id: scene.id, title: scene.title },
      };
    }
  throw new Error(`No scene ${index}`);
}
