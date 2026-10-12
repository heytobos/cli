import type { Manifest } from '@tobos/deck';
import type { DeckContext } from '../index.ts';
import {
  carry,
  cue as cueFor,
  formatHash,
  parseHash,
  same,
  START,
  step,
  type Cue,
  type Outline,
  type Position,
} from '../position.ts';
import { Stage, type SceneModule } from '../stage.svelte.ts';

export function outlineOf(manifest: Manifest): Outline {
  return {
    scenes: manifest.chapters.flatMap((c) => c.scenes.map((s) => ({ id: s.id, beats: s.beats }))),
  };
}

export function contextFor(manifest: Manifest, index: number): DeckContext {
  let n = 0;
  for (const chapter of manifest.chapters)
    for (const scene of chapter.scenes) {
      if (n++ === index)
        return {
          title: manifest.title,
          chapters: manifest.chapters.map((c) => ({
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

export interface PlayerOptions {
  still?: boolean;
  mountAhead?: boolean;
  onMove?: (position: Position, cue: Cue) => void;
}

/** A deck on a stage: the position, and moving it. */
export class Player {
  manifest: Manifest;
  outline: Outline;
  position: Position | null = null;
  readonly stage: Stage;
  /** Scene modules swapped in by live follow: specifier → URL. */
  private overrides = new Map<string, string>();

  private options: PlayerOptions;

  constructor(host: HTMLElement, manifest: Manifest, options: PlayerOptions = {}) {
    this.options = options;
    this.manifest = manifest;
    this.outline = outlineOf(manifest);
    this.stage = new Stage(host, {
      load: (index) => this.load(index),
      count: () => this.outline.scenes.length,
      context: (index) => contextFor(this.manifest, index),
      mountAhead: options.mountAhead,
      still: options.still,
    });
  }

  private specifier(index: number): string {
    return this.manifest.chapters.flatMap((c) => c.scenes)[index]!.module;
  }

  load(index: number): Promise<SceneModule> {
    const specifier = this.specifier(index);
    const url = this.overrides.get(specifier) ?? specifier;
    return import(/* @vite-ignore */ url) as Promise<SceneModule>;
  }

  get hash(): string {
    return this.position ? formatHash(this.outline, this.position) : '';
  }

  /** Go to a position. Only a single step forward animates, unless told otherwise. */
  go(to: Position, animate?: boolean): Promise<void> {
    if (same(this.position, to) && animate === undefined) return Promise.resolve();
    const cue = cueFor(this.outline, this.position, to);
    if (animate !== undefined) cue.animate = animate;
    this.position = to;
    this.options.onMove?.(to, cue);
    return this.stage.show(cue);
  }

  goHash(hash: string, animate?: boolean): Promise<void> {
    return this.go(parseHash(this.outline, hash) ?? START, animate);
  }

  step(delta: 1 | -1) {
    if (delta === 1 && this.stage.shown?.timeline.playing) {
      // A click during a beat finishes it at once and starts the next.
      this.stage.finish();
    }
    return this.go(step(this.outline, this.position ?? START, delta));
  }

  /**
   * Follow a push. Changed scene files swap in place; anything else (a shared component,
   * data, the master's styles) needs a fresh page, which the caller does.
   */
  async update(next: Manifest, base: string): Promise<'same' | 'swapped' | 'reload'> {
    const before = this.manifest;
    const changed = Object.keys(next.imports).filter(
      (key) => before.imports[key] !== next.imports[key],
    );
    const removed = Object.keys(before.imports).filter((key) => !(key in next.imports));
    const scenesOf = (m: Manifest) =>
      new Set(m.chapters.flatMap((c) => c.scenes.map((s) => s.module)));
    const sceneModules = scenesOf(next);
    const beforeScenes = scenesOf(before);
    const structure = (m: Manifest) => JSON.stringify(m.chapters);
    if (
      changed.length === 0 &&
      removed.length === 0 &&
      structure(before) === structure(next) &&
      JSON.stringify(before.media) === JSON.stringify(next.media) &&
      JSON.stringify(before.styles) === JSON.stringify(next.styles)
    )
      return 'same';
    if (
      removed.some((key) => !beforeScenes.has(key)) ||
      changed.some((key) => !sceneModules.has(key)) ||
      JSON.stringify(before.dependencies) !== JSON.stringify(next.dependencies) ||
      JSON.stringify(before.styles) !== JSON.stringify(next.styles)
    )
      return 'reload';

    for (const key of changed) this.overrides.set(key, new URL(next.imports[key]!, base).href);
    const outline = outlineOf(next);
    const position = this.position ? carry(this.outline, outline, this.position) : START;
    this.manifest = next;
    this.outline = outline;
    this.stage.reset();
    this.position = null;
    await this.go(position, false);
    return 'swapped';
  }

  destroy() {
    this.stage.destroy();
  }
}
