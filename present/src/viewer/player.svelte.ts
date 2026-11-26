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

/** The deck's scenes, in order. */
const scenesOf = (manifest: SharedManifest) => manifest.chapters.flatMap((c) => c.scenes);

/** A deck on a stage: the position, and moving it. */
export class Player {
  /** The deck as the server last had it: its scenes read their place in it from here. */
  manifest: SharedManifest = $state.raw() as unknown as SharedManifest;
  outline: Outline;
  position: Position | null = null;
  readonly stage: Stage;
  /** What the manifest's addresses are relative to, once a push gave it; until then the page. */
  private base: string | undefined;

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
      key: (index) => this.key(index),
      known: (key) => scenesOf(this.manifest).some((_, index) => this.key(index) === key),
      load: (index) => this.load(index),
      after: (index) => nextScene(this.outline, index, 1),
      context: (index) => this.context(index),
      mountAhead: options.mountAhead,
      still: options.still,
    });
  }

  /**
   * Scene `index` as the stage keeps it: its id and its module's address, which a build makes new
   * whenever what the scene shows changes (the deck's build.ts, emitModules).
   */
  private key(index: number): string {
    const scene = scenesOf(this.manifest)[index]!;
    return `${scene.id} ${this.manifest.imports[scene.module]}`;
  }

  load(index: number): Promise<SceneModule> {
    const specifier = scenesOf(this.manifest)[index]!.module;
    // After a push, at its address: the page's import map has the addresses it was opened with.
    const url = this.base ? new URL(this.manifest.imports[specifier]!, this.base).href : specifier;
    return import(/* @vite-ignore */ url) as Promise<SceneModule>;
  }

  /**
   * Where scene `index` sits in the deck, for as long as it is mounted: read from the manifest
   * each time, so a push that renames or moves it shows on the slide at once, without mounting it
   * again. A scene a push took out keeps its last place until it goes.
   */
  private context(index: number): DeckContext {
    const id = scenesOf(this.manifest)[index]!.id;
    let last = contextFor(this.manifest, index, this.options.presenting);
    const now = () => {
      const at = scenesOf(this.manifest).findIndex((s) => s.id === id);
      if (at !== -1) last = contextFor(this.manifest, at, this.options.presenting);
      return last;
    };
    return {
      get title() {
        return now().title;
      },
      get chapters() {
        return now().chapters;
      },
      get chapter() {
        return now().chapter;
      },
      get scene() {
        return now().scene;
      },
    };
  }

  get hash(): string {
    return this.position ? formatHash(this.outline, this.position) : '';
  }

  /**
   * Go to a position. Only a single step forward animates, unless told otherwise.
   */
  go(to: Position, animate?: boolean): Promise<void> {
    if (same(this.position, to) && animate === undefined) return Promise.resolve();
    const cue = cueFor(this.outline, this.position, to);
    if (animate !== undefined) cue.animate = animate;
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

  goHash(hash: string, animate?: boolean): Promise<void> {
    return this.go(this.positionOf(hash), animate);
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
   * Follow a push. The scene on screen stays as it is unless what it shows changed: its address
   * says so (key). One that did is shown anew at the same beat, the old one on screen until the
   * new one is mounted; the scenes around it follow the outline as it is now. What scenes import
   * through the page's import map, fixed at the addresses the page opened with, needs a fresh page,
   * which the caller loads: a package's module, and in a build that isn't linked (from before, or
   * with a cycle) the deck's own modules that aren't scenes. So do the master's styles; and in a
   * build that isn't linked its media, which its addresses don't follow, while a module looks up
   * its `$media` imports' URLs once, when it first runs (deck/src/media-imports.ts).
   */
  async update(next: SharedManifest, base: string): Promise<'same' | 'swapped' | 'reload'> {
    const before = this.manifest;
    const differ = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);
    const fixed = (key: string, m: SharedManifest) =>
      !(next.linked && key.startsWith('@deck/')) && !scenesOf(m).some((s) => s.module === key);
    const keys = new Set([...Object.keys(before.imports), ...Object.keys(next.imports)]);
    if (
      [...keys].some(
        (key) =>
          before.imports[key] !== next.imports[key] &&
          (key in next.imports ? fixed(key, next) : fixed(key, before)),
      ) ||
      differ(before.styles, next.styles) ||
      (!next.linked && differ(before.media, next.media))
    )
      return 'reload';

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
    const was = this.position && { key: this.key(this.position.scene), beat: this.position.beat };
    this.base = base;
    this.manifest = next;
    this.outline = outline;
    // Not while it is still on its way to the screen: shown again, it takes the same load.
    if (
      was &&
      !this.stage.busy &&
      was.key === this.key(position.scene) &&
      was.beat === position.beat
    ) {
      this.position = position;
      this.stage.moved(position.scene);
      return 'same';
    }
    this.position = null;
    await this.go(position, false);
    return 'swapped';
  }

  destroy() {
    this.stage.destroy();
  }
}
