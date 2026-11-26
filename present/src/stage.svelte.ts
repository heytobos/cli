import { flushSync, mount, unmount, type Component } from 'svelte';
import { DECK_CONTEXT, type Beat, type DeckContext, type SceneProps } from './index.ts';
import type { Cue } from './position.ts';
import { SceneTimeline } from './timeline.ts';
import { mediaKnowTheirLength } from './playback.ts';

/** A compiled scene file. */
export interface SceneModule {
  default: Component<SceneProps>;
  beats: readonly Beat[];
  preload?: () => Promise<unknown>;
}

export interface StageOptions {
  /**
   * What scene `index` is: the same key, the same slide, which a push that keeps it keeps mounted
   * wherever the outline moves it (the viewer's player.ts).
   */
  key: (index: number) => string;
  /** Whether a scene of the deck, as it is now, has this key. */
  known: (key: string) => boolean;
  /** Load scene `index`'s module. */
  load: (index: number) => Promise<SceneModule>;
  /** The scene a step forward from scene `index` goes to: undefined after the last. */
  after: (index: number) => number | undefined;
  /** The deck context for scene `index`, which a scene reads from then on, wherever it moves. */
  context: (index: number) => DeckContext;
  /** Mount the next scene ahead, out of sight. Off for render and the presenter's current view. */
  mountAhead?: boolean;
  /**
   * Never play animations: every cue lands on its end state, and loops stay at their start (the
   * presenter's own view, a render).
   */
  still?: boolean;
}

interface Layer {
  key: string;
  element: HTMLElement;
  instance: Record<string, unknown>;
  timeline: SceneTimeline;
  props: SceneProps;
  module: SceneModule;
}

// Safari has no requestIdleCallback.
const idle = (fn: () => void) =>
  typeof window.requestIdleCallback === 'function'
    ? window.requestIdleCallback(fn, { timeout: 2000 })
    : window.setTimeout(fn, 50);

/**
 * The scenes on one 1920×1080 stage, each by its key. What is on screen depends only on the last
 * cue: the current scene's layer, at the cue's beat.
 */
export class Stage {
  private layers = new Map<string, Layer>();
  private pending = new Map<string, Promise<Layer | undefined>>();
  /** Scenes mounted but still waiting for their videos and sounds, by their element. */
  private mounting = new Map<HTMLElement, Record<string, unknown>>();
  private current: Layer | null = null;
  /** Where the current scene is in the deck. */
  private at = -1;
  private seq = 0;
  /** The last cue's seq, once it is on screen. */
  private done = 0;
  private aheadTimer = 0;
  private destroyed = false;

  readonly host: HTMLElement;
  private options: StageOptions;

  constructor(host: HTMLElement, options: StageOptions) {
    this.host = host;
    this.options = options;
  }

  /** The layer being shown, for render and tests. */
  get shown(): { index: number; timeline: SceneTimeline; element: HTMLElement } | null {
    return this.current && { ...this.current, index: this.at };
  }

  async show(cue: Cue): Promise<void> {
    const seq = ++this.seq;
    window.clearTimeout(this.aheadTimer);
    const layer = await this.layer(cue.scene);
    if (seq !== this.seq || this.destroyed || !layer) return;

    const entering = this.current !== layer;
    if (entering) {
      this.current?.timeline.finish();
      this.current?.timeline.leave();
      for (const other of this.layers.values()) if (other !== layer) this.hide(other);
      this.reveal(layer);
      this.current = layer;
    }
    this.at = cue.scene;
    layer.element.dataset.scene = String(cue.scene);
    this.done = seq;
    layer.props.beat = layer.module.beats[cue.beat]?.id ?? '';
    layer.props.index = cue.beat;
    flushSync();

    const animate = cue.animate && !this.options.still;
    if (animate && entering && cue.beat === 0) layer.timeline.hold();
    layer.timeline.show(cue.beat, animate);

    // Mount the next scene once this one's entrance has had time to finish.
    this.around(
      seq,
      animate ? Math.min(1500, layer.timeline.duration(cue.beat) * 1000 + 100) : 100,
    );
  }

  /** Whether the last cue is still on its way to the screen: its scene loading, say. */
  get busy(): boolean {
    return this.done !== this.seq;
  }

  /**
   * The current scene, kept by a push, is at `scene` in the deck now: the scenes kept around it,
   * and the one mounted ahead, are those around it there. What it shows stays as it is.
   */
  moved(scene: number) {
    this.at = scene;
    if (this.current) this.current.element.dataset.scene = String(scene);
    window.clearTimeout(this.aheadTimer);
    this.around(this.seq, 100);
  }

  /** Keep the current scene and the next, and mount the next `wait` ms from now. */
  private around(seq: number, wait: number) {
    this.prune(this.at);
    const after = this.options.after(this.at);
    if (this.options.mountAhead !== false && after !== undefined)
      this.aheadTimer = window.setTimeout(() => idle(() => this.ahead(seq)), wait);
  }

  /**
   * Play animations from the next cue on, or land every cue on its end state. Loops start or stop
   * at once.
   */
  animate(on: boolean) {
    this.options.still = !on;
    if (!on) this.finish();
    for (const layer of this.layers.values()) layer.timeline.loops(on);
  }

  /** Finish whatever is playing, at once. */
  finish() {
    this.current?.timeline.finish();
  }

  destroy() {
    this.destroyed = true;
    window.clearTimeout(this.aheadTimer);
    for (const layer of this.layers.values()) this.unmountLayer(layer);
    for (const [element, instance] of this.mounting) {
      unmount(instance);
      element.remove();
    }
    this.mounting.clear();
    this.pending.clear();
    this.current = null;
  }

  /** Mount the scene after the current one: as the deck is when it runs, a push maybe since. */
  private async ahead(seq: number) {
    if (seq !== this.seq || this.destroyed) return;
    const index = this.options.after(this.at);
    if (index === undefined) return;
    const layer = await this.layer(index);
    if (!layer || layer === this.current) return;
    layer.timeline.hold();
  }

  private layer(index: number): Promise<Layer | undefined> {
    const key = this.options.key(index);
    let pending = this.pending.get(key);
    if (!pending) {
      // Its place in the deck now: a push while it loads may give `index` to another scene.
      const context = this.options.context(index);
      pending = this.options
        .load(index)
        .then((module) => {
          if (this.destroyed) return undefined;
          module.preload?.().catch((error) => console.warn('[tobos] preload failed', error));
          return this.mountLayer(key, index, context, module);
        })
        .catch((error) => {
          this.pending.delete(key);
          console.error(`[tobos] scene ${index} failed to load`, error);
          return undefined;
        });
      this.pending.set(key, pending);
    }
    return pending;
  }

  /**
   * Mount a scene, hidden, and build its timeline once its videos and sounds know their length
   * (a clip that plays to the end needs it).
   */
  private async mountLayer(
    key: string,
    index: number,
    context: DeckContext,
    module: SceneModule,
  ): Promise<Layer | undefined> {
    const element = document.createElement('div');
    element.className = 'tobos-layer';
    // Where it is in the deck, for tests: a push that moves the scene on screen says so (moved).
    element.dataset.scene = String(index);
    this.hide({ element });
    this.host.append(element);
    const props = $state<SceneProps>({ beat: module.beats[0]?.id ?? '', index: 0 });
    const instance = mount(module.default, {
      target: element,
      props,
      context: new Map([[DECK_CONTEXT, context]]),
    });
    flushSync();
    this.mounting.set(element, instance);
    await mediaKnowTheirLength(element);
    // Destroyed meanwhile: already unmounted.
    if (!this.mounting.delete(element)) return undefined;
    // A push changed or took out the scene meanwhile: loaded again if it comes back.
    if (!this.options.known(key)) {
      unmount(instance);
      element.remove();
      this.pending.delete(key);
      return undefined;
    }
    const timeline = new SceneTimeline(element, module.beats);
    timeline.loops(!this.options.still);
    const layer: Layer = { key, element, instance, timeline, props, module };
    this.layers.set(key, layer);
    return layer;
  }

  private unmountLayer(layer: Layer) {
    layer.timeline.kill();
    unmount(layer.instance);
    layer.element.remove();
    this.layers.delete(layer.key);
    this.pending.delete(layer.key);
  }

  /**
   * Keep the current scene and the next; drop the rest, each once its sound has faded out (it
   * goes with its elements), unless it is one of those two again by then. A scene a push changed
   * or took out has a key no scene has now, and goes too.
   */
  private prune(scene: number) {
    const kept = (layer: Layer, now: number) => {
      if (layer === this.current) return true;
      const after = this.options.after(now);
      return after !== undefined && layer.key === this.options.key(after);
    };
    for (const layer of [...this.layers.values()]) {
      if (kept(layer, scene)) continue;
      const fading = layer.timeline.fading;
      if (!fading) this.unmountLayer(layer);
      else
        void fading.then(() => {
          if (this.layers.get(layer.key) === layer && !kept(layer, this.at))
            this.unmountLayer(layer);
        });
    }
  }

  private hide(layer: { element: HTMLElement }) {
    layer.element.style.visibility = 'hidden';
    layer.element.inert = true;
    layer.element.setAttribute('aria-hidden', 'true');
  }

  private reveal(layer: Layer) {
    layer.element.style.visibility = '';
    layer.element.inert = false;
    layer.element.removeAttribute('aria-hidden');
  }
}
