import type { Activity, Manifest } from './types.ts';

/** A field's limit when the scene sets none, in characters. */
export const TEXT_MAX = 500;

/**
 * The activity the room may answer while the deck is presented at a position: the scene's,
 * from its first beat up to, not including, its `reveals` beat. The one rule for what is open,
 * on the server and in the viewer alike.
 */
export function openActivity(
  manifest: Manifest,
  at: { scene: string; beat: string },
): Activity | undefined {
  for (const chapter of manifest.chapters)
    for (const scene of chapter.scenes) {
      if (scene.id !== at.scene) continue;
      const { activity } = scene;
      const beat = scene.beats.indexOf(at.beat);
      if (!activity || beat < 0) return undefined;
      const reveals = activity.kind === 'choice' && activity.reveals;
      if (reveals && beat >= scene.beats.indexOf(reveals)) return undefined;
      return activity;
    }
  return undefined;
}

/** Every activity in the deck, in the order of its scenes. */
export function activitiesOf(manifest: Manifest): Activity[] {
  return manifest.chapters.flatMap((c) =>
    c.scenes.flatMap((s) => (s.activity ? [s.activity] : [])),
  );
}
