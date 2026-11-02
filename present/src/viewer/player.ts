import type { SharedManifest } from '@tobos/deck';
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
import { hiddenPlace, shownOf } from './shown.ts';

export function outlineOf(manifest: SharedManifest): Outline {
  return {
    scenes: manifest.chapters.flatMap((c) => c.scenes.map((s) => ({ id: s.id, beats: s.beats }))),
  };
}

export function contextFor(manifest: SharedManifest, index: number): DeckContext {
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
  /** A show's window, the audience's or the presenter's: it skips the hidden scenes (shownOf). */
  skipHidden?: boolean;
  still?: boolean;
  mountAhead?: boolean;
  onMove?: (position: Position, cue: Cue) => void;
}

/** A deck on a stage: the position, and moving it. */
export class Player {
  /** The deck as this player shows it: in a show, without its hidden scenes. */
  manifest: SharedManifest;
  /** The deck with every scene, hidden or not: where a hidden scene's place is. */
  private all: SharedManifest;
  outline: Outline;
  position: Position | null = null;
  readonly stage: Stage;
  /** Scene modules swapped in by live follow: specifier → URL. */
  private overrides = new Map<string, string>();

  private options: PlayerOptions;

  constructor(host: HTMLElement, manifest: SharedManifest, options: PlayerOptions = {}) {
    this.options = options;
    this.all = manifest;
    this.manifest = options.skipHidden ? shownOf(manifest) : manifest;
    this.outline = outlineOf(this.manifest);
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

  /**
   * Go to a position. Only a single step forward animates, unless told otherwise; `aloud: false`
   * plays it without its sound.
   */
  go(to: Position, animate?: boolean, aloud = true): Promise<void> {
    if (same(this.position, to) && animate === undefined) return Promise.resolve();
    const cue = cueFor(this.outline, this.position, to);
    if (animate !== undefined) cue.animate = animate;
    cue.aloud = aloud;
    this.position = to;
    this.options.onMove?.(to, cue);
    return this.stage.show(cue);
  }

  goHash(hash: string, animate?: boolean, aloud?: boolean): Promise<void> {
    return this.go(this.positionOf(hash), animate, aloud);
  }

  /**
   * Where `hash` is in this player's deck. A scene the show skips, as the deck's page may have
   * been on when presenting began, or is on now, is at the start of the next scene that shows, or
   * at the end of the last one if none follows. Undefined if `hash` names nothing.
   */
  placeOf(hash: string): Position | undefined {
    return parseHash(this.outline, hash) ?? hiddenPlace(this.all, this.outline, hash);
  }

  /** Where `hash` is, placeOf; a hash that names nothing is the start. */
  positionOf(hash: string): Position {
    return this.placeOf(hash) ?? START;
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
   * data, the master's styles, media) needs a fresh page, which the caller does. Media too: a
   * module looks up its `$media` imports' URLs once, when it first runs (deck/src/media-imports.ts),
   * and the browser runs a module it has once, so only a fresh page sees a file's new address.
   */
  async update(all: SharedManifest, base: string): Promise<'same' | 'swapped' | 'reload'> {
    const before = this.manifest;
    const next = this.options.skipHidden ? shownOf(all) : all;
    const changed = Object.keys(next.imports).filter(
      (key) => before.imports[key] !== next.imports[key],
    );
    const removed = Object.keys(before.imports).filter((key) => !(key in next.imports));
    const scenesOf = (m: SharedManifest) =>
      new Set(m.chapters.flatMap((c) => c.scenes.map((s) => s.module)));
    // Hidden scenes' modules too: one changed or gone is still a scene's, which a swap takes.
    const sceneModules = scenesOf(all);
    const beforeScenes = scenesOf(this.all);
    const structure = (m: SharedManifest) => JSON.stringify(m.chapters);
    if (
      changed.length === 0 &&
      removed.length === 0 &&
      structure(before) === structure(next) &&
      JSON.stringify(before.media) === JSON.stringify(next.media) &&
      JSON.stringify(before.styles) === JSON.stringify(next.styles)
    ) {
      // Nothing on stage changes, but what is said about the deck may: its title.
      this.manifest = next;
      this.all = all;
      return 'same';
    }
    if (
      removed.some((key) => !beforeScenes.has(key)) ||
      changed.some((key) => !sceneModules.has(key)) ||
      JSON.stringify(before.dependencies) !== JSON.stringify(next.dependencies) ||
      JSON.stringify(before.styles) !== JSON.stringify(next.styles) ||
      JSON.stringify(before.media) !== JSON.stringify(next.media)
    )
      return 'reload';

    for (const key of changed) this.overrides.set(key, new URL(next.imports[key]!, base).href);
    const outline = outlineOf(next);
    // A show whose scene was just hidden goes on where it would have started on it: the next
    // scene that shows. carry would put it by beat count, partway into another.
    const current = this.position && this.outline.scenes[this.position.scene];
    const hidden =
      this.options.skipHidden && current ? hiddenPlace(all, outline, current.id) : undefined;
    const position = this.position
      ? (hidden ?? carry(this.outline, outline, this.position))
      : START;
    this.manifest = next;
    this.all = all;
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
