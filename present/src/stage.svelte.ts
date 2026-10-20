import { flushSync, mount, unmount, type Component } from 'svelte';
import { DECK_CONTEXT, type Beat, type DeckContext, type SceneProps } from './index.ts';
import type { Cue } from './position.ts';
import { SceneTimeline } from './timeline.ts';
import { videosKnowTheirLength } from './video.ts';

/** A compiled scene file. */
export interface SceneModule {
  default: Component<SceneProps>;
  beats: readonly Beat[];
  preload?: () => Promise<unknown>;
}

export interface StageOptions {
  /** Load scene `index`'s module. */
  load: (index: number) => Promise<SceneModule>;
  /** How many scenes there are. */
  count: () => number;
  /** The deck context for scene `index`. */
  context: (index: number) => DeckContext;
  /** Mount the next scene ahead, out of sight. Off for render and the presenter's current view. */
  mountAhead?: boolean;
  /** Never play animations: every cue lands on its end state (the presenter's own view). */
  still?: boolean;
}

interface Layer {
  index: number;
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
 * The scenes on one 1920×1080 stage. What is on screen depends only on the last cue:
 * the current scene's layer, at the cue's beat.
 */
export class Stage {
  private layers = new Map<number, Layer>();
  private pending = new Map<number, Promise<Layer | undefined>>();
  /** Scenes mounted but still waiting for their videos, by their element. */
  private mounting = new Map<HTMLElement, { index: number; instance: Record<string, unknown> }>();
  private current: Layer | null = null;
  private seq = 0;
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
    return this.current;
  }

  async show(cue: Cue): Promise<void> {
    const seq = ++this.seq;
    window.clearTimeout(this.aheadTimer);
    const layer = await this.layer(cue.scene);
    if (seq !== this.seq || this.destroyed || !layer) return;

    const entering = this.current !== layer;
    if (entering) {
      this.current?.timeline.finish();
      for (const other of this.layers.values()) if (other !== layer) this.hide(other);
      this.reveal(layer);
      this.current = layer;
    }
    layer.props.beat = layer.module.beats[cue.beat]?.id ?? '';
    layer.props.index = cue.beat;
    flushSync();

    const animate = cue.animate && !this.options.still;
    if (animate && entering && cue.beat === 0) layer.timeline.hold();
    layer.timeline.show(cue.beat, animate);

    this.prune(cue.scene);
    if (this.options.mountAhead !== false && cue.scene + 1 < this.options.count()) {
      // Mount the next scene once this one's entrance has had time to finish.
      const wait = animate ? Math.min(1500, layer.timeline.duration(cue.beat) * 1000 + 100) : 100;
      this.aheadTimer = window.setTimeout(() => idle(() => this.ahead(cue.scene + 1, seq)), wait);
    }
  }

  /** Play animations from the next cue on, or land every cue on its end state. */
  animate(on: boolean) {
    this.options.still = !on;
    if (!on) this.finish();
  }

  /** Finish whatever is playing, at once. */
  finish() {
    this.current?.timeline.finish();
  }

  /** Forget every mounted scene (after the deck's structure changed). */
  reset() {
    for (const layer of this.layers.values()) this.unmountLayer(layer);
    this.cancelMounting(() => true);
    this.pending.clear();
    this.current = null;
  }

  destroy() {
    this.destroyed = true;
    window.clearTimeout(this.aheadTimer);
    this.reset();
  }

  private async ahead(index: number, seq: number) {
    if (seq !== this.seq || this.destroyed) return;
    const layer = await this.layer(index);
    if (!layer || layer === this.current) return;
    layer.timeline.hold();
  }

  private layer(index: number): Promise<Layer | undefined> {
    let pending = this.pending.get(index);
    if (!pending) {
      pending = this.options
        .load(index)
        .then((module) => {
          if (this.destroyed) return undefined;
          module.preload?.().catch((error) => console.warn('[tobos] preload failed', error));
          return this.mountLayer(index, module);
        })
        .catch((error) => {
          this.pending.delete(index);
          console.error(`[tobos] scene ${index} failed to load`, error);
          return undefined;
        });
      this.pending.set(index, pending);
    }
    return pending;
  }

  /**
   * Mount a scene, hidden, and build its timeline once its videos know their length (a clip
   * that plays to a video's end needs it).
   */
  private async mountLayer(index: number, module: SceneModule): Promise<Layer | undefined> {
    const element = document.createElement('div');
    element.className = 'tobos-layer';
    element.dataset.scene = String(index);
    this.hide({ element });
    this.host.append(element);
    const props = $state<SceneProps>({ beat: module.beats[0]?.id ?? '', index: 0 });
    const instance = mount(module.default, {
      target: element,
      props,
      context: new Map([[DECK_CONTEXT, this.options.context(index)]]),
    });
    flushSync();
    this.mounting.set(element, { index, instance });
    await videosKnowTheirLength(element);
    // Cancelled meanwhile (a reset, or a newer version of the scene): already unmounted.
    if (!this.mounting.delete(element)) return undefined;
    const timeline = new SceneTimeline(element, module.beats);
    const layer: Layer = { index, element, instance, timeline, props, module };
    this.layers.set(index, layer);
    return layer;
  }

  private cancelMounting(which: (m: { index: number }) => boolean) {
    for (const [element, m] of [...this.mounting])
      if (which(m)) {
        this.mounting.delete(element);
        unmount(m.instance);
        element.remove();
      }
  }

  private unmountLayer(layer: Layer) {
    layer.timeline.kill();
    unmount(layer.instance);
    layer.element.remove();
    this.layers.delete(layer.index);
    this.pending.delete(layer.index);
  }

  /** Keep the current scene and the next; drop the rest. */
  private prune(scene: number) {
    for (const layer of [...this.layers.values()])
      if (layer.index !== scene && layer.index !== scene + 1) this.unmountLayer(layer);
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
