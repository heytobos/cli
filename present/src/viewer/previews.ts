import type { SharedManifest } from '@tobos/deck';
import { flushSync, mount, unmount } from 'svelte';
import { DECK_CONTEXT, type SceneProps } from '../index.ts';
import { SKELETON, unveil } from '../skeleton.ts';
import type { SceneModule } from '../stage.svelte.ts';
import { SceneTimeline } from '../timeline.ts';
import { sceneProps } from './contents.svelte.ts';
import { contextFor } from './shown.ts';

/** The previews kept drawn, the least recently shown going first. */
const KEEP = 20;

/** A scene drawn small, as print.ts draws a page: the 1920×1080 stage scaled into its box. */
export interface Preview {
  /** Its box, sized by CSS (16:9, the width it is given). */
  box: HTMLElement;
  /** Put on a step: -1 for its last, the whole slide. Once drawn, if it isn't yet. */
  step: (step: number) => void;
}

interface Drawn {
  instance: ReturnType<typeof mount>;
  timeline: SceneTimeline;
  props: SceneProps;
  ids: string[];
  page: HTMLElement;
  observer: MutationObserver;
}

interface Entry extends Preview {
  drawn?: Drawn;
  sized?: ResizeObserver;
  gone: boolean;
}

/** What a preview holds let go: its scene unmounted, its observers off. */
function release(entry: Entry) {
  entry.gone = true;
  entry.sized?.disconnect();
  if (!entry.drawn) return;
  entry.drawn.observer.disconnect();
  entry.drawn.timeline.kill();
  void unmount(entry.drawn.instance);
  entry.drawn = undefined;
}

/** A scene's code by its address in this manifest, which a push that changes the scene changes. */
function keyOf(manifest: SharedManifest, index: number): string | undefined {
  const scene = manifest.chapters.flatMap((c) => c.scenes)[index];
  return scene && `${scene.module} ${manifest.imports[scene.module] ?? ''}`;
}

/**
 * A share link's previews of its scenes (contents.ts): each scene's code fetched once its row is
 * near the list's sight (`warm`), so a preview shown at once draws in the same frame; at most KEEP
 * kept drawn, the least recently shown unmounted; none of a video's or a sound's media fetched.
 * A push brings a new manifest, which draws them afresh.
 */
export class Previews {
  private modules = new Map<string, SceneModule>();
  private loading = new Map<string, Promise<SceneModule>>();
  private entries = new Map<number, Entry>();
  private manifest: SharedManifest | undefined;

  /** A scene's code as the player loads it, from where the deck now has it. */
  private load: (index: number) => Promise<SceneModule>;

  constructor(load: (index: number) => Promise<SceneModule>) {
    this.load = load;
  }

  /** The scene's code, fetched now if it isn't on its way. */
  warm(manifest: SharedManifest, index: number): Promise<SceneModule> | undefined {
    const key = keyOf(manifest, index);
    if (!key) return undefined;
    const module = this.modules.get(key);
    if (module) return Promise.resolve(module);
    let loading = this.loading.get(key);
    if (!loading) {
      loading = this.load(index).then((m) => {
        this.modules.set(key, m);
        return m;
      });
      // A failed fetch may be tried again.
      loading.catch(() => this.loading.delete(key));
      this.loading.set(key, loading);
    }
    return loading;
  }

  /** Scene `index`'s preview, drawn now when its code is in, else its ghost until it is. */
  get(manifest: SharedManifest, index: number): Preview {
    if (manifest !== this.manifest) {
      this.clear();
      this.manifest = manifest;
    }
    const kept = this.entries.get(index);
    if (kept) {
      // The most recently shown, last.
      this.entries.delete(index);
      this.entries.set(index, kept);
      return kept;
    }
    const box = document.createElement('div');
    box.className = 'tobos-preview-slide';
    // A picture of the slide: what it holds isn't for the keys, nor a screen reader.
    box.inert = true;
    const page = document.createElement('div');
    page.className = 'tobos-stage';
    box.append(page);
    let wanted = -1;
    const entry: Entry = {
      box,
      gone: false,
      step: (step) => {
        wanted = step;
        if (entry.drawn) stepTo(entry.drawn, step);
      },
    };
    const fit = () => (page.style.transform = `scale(${box.clientWidth / 1920})`);
    entry.sized = new ResizeObserver(fit);
    entry.sized.observe(box);
    // Its code that didn't come, or a scene that threw: kept no more, so the next visit tries again.
    const forget = () => {
      release(entry);
      if (this.entries.get(index) === entry) this.entries.delete(index);
    };
    const ready = (module: SceneModule) => {
      if (entry.gone) return;
      try {
        entry.drawn = draw(manifest, index, module, page);
        if (wanted >= 0) stepTo(entry.drawn, wanted);
      } catch (error) {
        console.error(error);
        forget();
      }
    };
    this.entries.set(index, entry);
    this.evict(index);
    const key = keyOf(manifest, index);
    const module = key && this.modules.get(key);
    if (module) ready(module);
    else {
      // Its code still on its way: the slide's ghost (skeleton.ts) until it is drawn. Only then,
      // or every preview would fade in from a ghost.
      const holder = document.createElement('div');
      holder.innerHTML = SKELETON;
      const ghost = holder.firstElementChild as HTMLElement;
      box.append(ghost);
      void this.warm(manifest, index)?.then((m) => {
        ready(m);
        unveil(ghost);
      }, forget);
    }
    return entry;
  }

  /** Down to KEEP: the least recently shown go, never `keep`, the one just asked for. */
  private evict(keep: number) {
    for (const [index, entry] of this.entries) {
      if (this.entries.size <= KEEP) break;
      if (index === keep || entry.box.isConnected) continue;
      this.drop(index, entry);
    }
  }

  private drop(index: number, entry: Entry) {
    release(entry);
    entry.box.remove();
    this.entries.delete(index);
  }

  /** Every preview unmounted. */
  clear() {
    for (const [index, entry] of [...this.entries]) this.drop(index, entry);
  }
}

/** The scene mounted at its last step, still, with no media. */
function draw(
  manifest: SharedManifest,
  index: number,
  module: SceneModule,
  page: HTMLElement,
): Drawn {
  const ids = module.beats.map((b) => b.id);
  const last = Math.max(0, ids.length - 1);
  const props = sceneProps(ids[last] ?? '', last);
  const instance = mount(module.default, {
    target: page,
    props,
    context: new Map([[DECK_CONTEXT, contextFor(manifest, index)]]),
  });
  flushSync();
  // Before the browser picks a source, which it does in a task after this one: a video or a sound
  // with none fetches nothing. One that appears later, at another step, goes the same way.
  still(page);
  const observer = new MutationObserver(() => still(page));
  observer.observe(page, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['src'],
  });
  try {
    const timeline = withoutLengths(() => new SceneTimeline(page, module.beats));
    timeline.loops(false);
    withoutLengths(() => timeline.show(last, false));
    return { instance, timeline, props, ids, page, observer };
  } catch (error) {
    // A beat that throws: the scene unmounted, not left behind.
    observer.disconnect();
    void unmount(instance);
    throw error;
  }
}

/** On a step, landed on, not played: -1, the last. */
function stepTo(drawn: Drawn, step: number) {
  const k = step < 0 ? drawn.ids.length - 1 : Math.min(step, drawn.ids.length - 1);
  if (drawn.props.index === k) return;
  drawn.props.beat = drawn.ids[k] ?? '';
  drawn.props.index = k;
  flushSync();
  still(drawn.page);
  withoutLengths(() => drawn.timeline.show(k, false));
}

/**
 * `run`, without playback.ts's warning that a clip's length isn't known: a preview loads no
 * media, so none is, and the warning would send a deck's author looking for a fault in it.
 */
function withoutLengths<T>(run: () => T): T {
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    if (!(typeof args[0] === 'string' && /^\[tobos\] play(Video|Audio): .*length/.test(args[0])))
      warn(...args);
  };
  try {
    return run();
  } finally {
    console.warn = warn;
  }
}

/**
 * A preview's videos and sounds hold still and fetch nothing: their sources taken out. A video
 * shows its poster where the deck gave one, else the slide around it.
 */
function still(page: HTMLElement) {
  for (const media of page.querySelectorAll<HTMLMediaElement>('video, audio')) {
    if (media.hasAttribute('src')) media.removeAttribute('src');
    for (const source of media.querySelectorAll('source')) source.remove();
    media.preload = 'none';
    media.autoplay = false;
  }
}
