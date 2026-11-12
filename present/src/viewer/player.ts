import type { SharedManifest } from '@tobos/deck';
import type { DeckContext } from '../index.ts';
import {
  carry,
  cue as cueFor,
  firstShown,
  formatHash,
  nextScene,
  parseHash,
  same,
  sceneStep,
  shownFrom,
  step,
  type Cue,
  type Outline,
  type Position,
} from '../position.ts';
import { skeleton, unveil } from '../skeleton.ts';
import { Stage, type SceneModule } from '../stage.svelte.ts';
import { settled } from './ready.ts';
import { contextFor } from './shown.ts';

/** The deck's outline; `presenting`, its hidden scenes marked, for its steps to go over. */
export function outlineOf(manifest: SharedManifest, presenting = false): Outline {
  return {
    scenes: manifest.chapters.flatMap((c) =>
      c.scenes.map((s) => ({
        id: s.id,
        beats: s.beats,
        ...(presenting && s.hidden ? { hidden: true } : {}),
      })),
    ),
  };
}

export interface PlayerOptions {
  /**
   * The audience's window or the presenter's: its steps go over the hidden scenes, which are on
   * screen only when gone to, and an agenda on the others leaves them out (contextFor).
   */
  presenting?: boolean;
  still?: boolean;
  mountAhead?: boolean;
  /** A slide's ghost on the stage until its first scene is drawn, for a page someone watches. */
  skeleton?: boolean;
  onMove?: (position: Position, cue: Cue) => void;
}

/** A deck on a stage: the position, and moving it. */
export class Player {
  manifest: SharedManifest;
  outline: Outline;
  position: Position | null = null;
  readonly stage: Stage;
  /** Scene modules swapped in by live follow: specifier → URL. */
  private overrides = new Map<string, string>();

  private options: PlayerOptions;
  private host: HTMLElement;
  /** The ghost, until a scene is drawn. */
  private ghost: HTMLElement | undefined;

  constructor(host: HTMLElement, manifest: SharedManifest, options: PlayerOptions = {}) {
    this.options = options;
    this.host = host;
    if (options.skeleton) this.ghost = skeleton(host);
    this.manifest = manifest;
    this.outline = outlineOf(manifest, options.presenting);
    this.stage = new Stage(host, {
      load: (index) => this.load(index),
      after: (index) => nextScene(this.outline, index, 1),
      context: (index) => contextFor(this.manifest, index, options.presenting),
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
    const shown = this.stage.show(cue);
    if (!this.ghost) return shown;
    // The ghost goes with the first move not overtaken by another, drawn or failed: a scene that
    // failed to load leaves the stage empty, and a ghost would say it is still coming.
    return shown.finally(() => {
      if (this.position === to) this.drawn();
    });
  }

  /**
   * The ghost fades once what the stage shows has its fonts and pictures drawn, or after 3 s: a
   * slide's text shouldn't wait behind it for a video an iPhone loads no frame of until it plays.
   */
  private drawn() {
    const ghost = this.ghost;
    if (!ghost) return;
    this.ghost = undefined;
    void settled(this.host, 3000).then(() => unveil(ghost));
  }

  goHash(hash: string, animate?: boolean, aloud?: boolean): Promise<void> {
    return this.go(this.positionOf(hash), animate, aloud);
  }

  /** Where `hash` is, hidden scene or not; a hash that names nothing is the first that shows. */
  positionOf(hash: string): Position {
    return parseHash(this.outline, hash) ?? firstShown(this.outline);
  }

  /**
   * Where presenting begins in a window opened on `hash`: as the deck's page may have been on a
   * hidden scene, at the start of the next scene that shows (shownFrom).
   */
  startOf(hash: string): Position {
    return shownFrom(this.outline, this.positionOf(hash));
  }

  step(delta: 1 | -1) {
    if (delta === 1 && this.stage.shown?.timeline.playing) {
      // A click during a beat finishes it at once and starts the next.
      this.stage.finish();
    }
    return this.go(step(this.outline, this.position ?? firstShown(this.outline), delta));
  }

  /** To the start of the next scene or the previous one (sceneStep). */
  stepScene(delta: 1 | -1) {
    return this.go(sceneStep(this.outline, this.position ?? firstShown(this.outline), delta));
  }

  /**
   * Follow a push. Changed scene files swap in place; anything else (a shared component,
   * data, the master's styles, media) needs a fresh page, which the caller does. Media too: a
   * module looks up its `$media` imports' URLs once, when it first runs (deck/src/media-imports.ts),
   * and the browser runs a module it has once, so only a fresh page sees a file's new address.
   */
  async update(next: SharedManifest, base: string): Promise<'same' | 'swapped' | 'reload'> {
    const before = this.manifest;
    const changed = Object.keys(next.imports).filter(
      (key) => before.imports[key] !== next.imports[key],
    );
    const removed = Object.keys(before.imports).filter((key) => !(key in next.imports));
    const scenesOf = (m: SharedManifest) =>
      new Set(m.chapters.flatMap((c) => c.scenes.map((s) => s.module)));
    const sceneModules = scenesOf(next);
    const beforeScenes = scenesOf(before);
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
    const outline = outlineOf(next, this.options.presenting);
    // A scene just hidden while it's on stays on: the next step goes on from it. One gone is
    // carried by beat count, which may land in a hidden scene: then at the next that shows.
    const id = this.position && this.outline.scenes[this.position.scene]?.id;
    const carried = this.position ? carry(this.outline, outline, this.position) : undefined;
    const position = !carried
      ? firstShown(outline)
      : outline.scenes.some((s) => s.id === id)
        ? carried
        : shownFrom(outline, carried);
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
