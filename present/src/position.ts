/** The structure the engine navigates: scenes in order, each with its beat IDs. */
export interface Outline {
  scenes: { id: string; beats: string[] }[];
}

/** A beat, by indices into the outline. */
export interface Position {
  scene: number;
  beat: number;
}

/**
 * What to show: a position, and whether to play its animation or land on its end state, and
 * whether that animation's sound plays (unless said, it does).
 */
export interface Cue extends Position {
  animate: boolean;
  aloud?: boolean;
}

export const START: Position = { scene: 0, beat: 0 };

/** The position's number among all beats, from 0. */
export function ordinal(outline: Outline, position: Position): number {
  let n = 0;
  for (let s = 0; s < position.scene; s++) n += outline.scenes[s]!.beats.length;
  return n + position.beat;
}

export function count(outline: Outline): number {
  return outline.scenes.reduce((n, scene) => n + scene.beats.length, 0);
}

export function fromOrdinal(outline: Outline, n: number): Position {
  const total = count(outline);
  let rest = Math.max(0, Math.min(n, total - 1));
  for (let scene = 0; scene < outline.scenes.length; scene++) {
    const beats = outline.scenes[scene]!.beats.length;
    if (rest < beats) return { scene, beat: rest };
    rest -= beats;
  }
  return START;
}

/** Move by `delta` beats, stopping at either end. */
export function step(outline: Outline, from: Position, delta: number): Position {
  return fromOrdinal(outline, ordinal(outline, from) + delta);
}

/**
 * The cue for moving from one position to another. Only a single step forward animates;
 * anything else (back, jumps, reloads) lands on the end state.
 */
export function cue(outline: Outline, from: Position | null, to: Position): Cue {
  const animate = from !== null && ordinal(outline, to) === ordinal(outline, from) + 1;
  return { ...to, animate };
}

/** Read a position from a URL hash: `#scene/beat`, `#scene/2` (the third beat), `#scene`. */
export function parseHash(outline: Outline, hash: string): Position | undefined {
  let ref: string;
  try {
    ref = decodeURIComponent(hash.replace(/^#/, '')).trim();
  } catch {
    return undefined; // A malformed escape, like `#%`: a bad link starts at the beginning.
  }
  if (ref === '') return undefined;
  const [sceneId, beatRef] = ref.split('/');
  const scene = outline.scenes.findIndex((s) => s.id === sceneId);
  if (scene < 0) return undefined;
  const beats = outline.scenes[scene]!.beats;
  if (beatRef === undefined || beatRef === '') return { scene, beat: 0 };
  if (/^\d+$/.test(beatRef)) {
    const beat = Number(beatRef);
    return beat < beats.length ? { scene, beat } : undefined;
  }
  const beat = beats.indexOf(beatRef);
  return beat < 0 ? undefined : { scene, beat };
}

export function formatHash(outline: Outline, position: Position): string {
  const scene = outline.scenes[position.scene];
  if (!scene) return '';
  return `#${scene.id}/${scene.beats[position.beat] ?? position.beat}`;
}

/** The same beat in a changed outline, by IDs; else the nearest one that still exists. */
export function carry(from: Outline, to: Outline, position: Position): Position {
  const scene = from.scenes[position.scene];
  if (scene) {
    const s = to.scenes.findIndex((x) => x.id === scene.id);
    if (s >= 0) {
      const b = to.scenes[s]!.beats.indexOf(scene.beats[position.beat] ?? '');
      return {
        scene: s,
        beat: b >= 0 ? b : Math.min(position.beat, to.scenes[s]!.beats.length - 1),
      };
    }
  }
  return fromOrdinal(to, ordinal(from, position));
}

export function same(a: Position | null, b: Position | null): boolean {
  return a !== null && b !== null && a.scene === b.scene && a.beat === b.beat;
}
