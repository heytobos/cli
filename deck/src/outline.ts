/**
 * A deck's outline, held by Tobos, joined with a build, which the deck's code makes (ADR 0006):
 * the outline says which scenes show, in what order, under which titles; the build what each is.
 * Joined when a manifest is read, never when the deck is compiled, so a change to the outline
 * reaches the viewer without a build.
 */
import type {
  Build,
  BuildScene,
  LegacyBuild,
  Manifest,
  ManifestChapter,
  Outline,
  StoredBuild,
} from './types.ts';

const isLegacy = (build: { scenes?: unknown; chapters?: unknown }): build is LegacyBuild =>
  !('scenes' in build) && Array.isArray(build.chapters);

/**
 * A build's scenes by id: every scene file's, or for one stored before ADR 0006, those deck.json
 * listed, which were the only ones it compiled as scenes.
 */
export function buildScenes(
  build: { scenes: Record<string, BuildScene> } | { chapters: ManifestChapter[] },
): Record<string, BuildScene> {
  if (!isLegacy(build as StoredBuild))
    return (build as { scenes: Record<string, BuildScene> }).scenes;
  const scenes: Record<string, BuildScene> = Object.create(null);
  for (const chapter of (build as LegacyBuild).chapters)
    for (const { id, title: _, hidden: __, ...scene } of chapter.scenes) scenes[id] = scene;
  return scenes;
}

/**
 * A build as one stored from now on has it: one stored before ADR 0006 without its title and
 * chapters, its scenes by id. What a version that keeps the build before it stores, so nothing
 * takes the outline it had for the deck's (refillOutlines, in the app).
 */
export function currentBuild(build: StoredBuild): Build {
  if (!isLegacy(build)) return build;
  const { title: _, chapters: __, ...rest } = build;
  return { ...rest, scenes: buildScenes(build) };
}

/** The outline a build stored before ADR 0006 had, from deck.json: where the deck's came from. */
export function legacyOutline(build: LegacyBuild): Outline {
  return {
    title: build.title,
    chapters: build.chapters.map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      scenes: chapter.scenes.map((scene) => ({
        id: scene.id,
        title: scene.title,
        ...(scene.hidden ? { hidden: true as const } : {}),
      })),
    })),
  };
}

/**
 * A build with the deck's outline joined in, as the viewer, presenting, the share link, its PDF
 * and stills read it: the scenes the outline places that the build has, in the outline's order,
 * with its titles and what it hides. A chapter left with none isn't in it.
 */
export function joinOutline(build: StoredBuild, outline: Outline): Manifest {
  const scenes = buildScenes(build);
  const {
    scenes: _,
    title: __,
    chapters: ___,
    ...rest
  } = build as Partial<Pick<LegacyBuild, 'title' | 'chapters'>> &
    Partial<Pick<Extract<StoredBuild, { scenes: unknown }>, 'scenes'>> &
    Omit<Manifest, 'title' | 'chapters'>;
  return {
    ...rest,
    title: outline.title,
    chapters: outline.chapters
      .map((chapter) => ({
        id: chapter.id,
        title: chapter.title,
        scenes: chapter.scenes
          .filter((scene) => Object.hasOwn(scenes, scene.id))
          .map((scene) => ({
            id: scene.id,
            title: scene.title,
            ...(scene.hidden ? { hidden: true as const } : {}),
            ...scenes[scene.id]!,
          })),
      }))
      .filter((chapter) => chapter.scenes.length > 0),
  };
}

/** The scenes a build has that the outline doesn't place, by id: what waits to be placed. */
export function unplacedScenes(build: StoredBuild, outline: Outline): string[] {
  const placed = new Set(outline.chapters.flatMap((c) => c.scenes.map((s) => s.id)));
  return Object.keys(buildScenes(build))
    .filter((id) => !placed.has(id))
    .sort();
}
