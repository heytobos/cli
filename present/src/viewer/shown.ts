import type { SharedManifest } from '@tobos/deck';

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
