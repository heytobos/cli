import type { SharedManifest } from '@tobos/deck';
import type { Outline, Position } from '../position.ts';

/**
 * The deck as the show has it: without the scenes deck.json hides from the audience, and without
 * a chapter they leave empty. deck.json always has a scene that shows.
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
 * Where the show is when `hash` names a scene it skips, as the deck's page may have been on when
 * presenting began: at the start of the next scene that shows, or at the end of the last one if
 * none follows. Undefined if `hash` names no hidden scene of `all`.
 */
export function hiddenPlace(
  all: SharedManifest,
  shown: Outline,
  hash: string,
): Position | undefined {
  let id: string | undefined;
  try {
    // Read as parseHash reads it (position.ts).
    id = decodeURIComponent(hash.replace(/^#/, '')).trim().split('/')[0];
  } catch {
    return undefined;
  }
  const scenes = all.chapters.flatMap((c) => c.scenes);
  const hidden = scenes.findIndex((s) => s.hidden && s.id === id);
  if (hidden < 0) return undefined;
  for (const scene of scenes.slice(hidden + 1)) {
    const index = shown.scenes.findIndex((s) => s.id === scene.id);
    if (index >= 0) return { scene: index, beat: 0 };
  }
  const last = shown.scenes.length - 1;
  return { scene: last, beat: Math.max(0, shown.scenes[last]!.beats.length - 1) };
}
