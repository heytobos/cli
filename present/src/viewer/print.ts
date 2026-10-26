import { flushSync, mount } from 'svelte';
import { DECK_CONTEXT } from '../index.ts';
import type { SceneModule } from '../stage.svelte.ts';
import { SceneTimeline } from '../timeline.ts';
import { mediaKnowTheirLength } from '../playback.ts';
import type { ViewerConfig } from './config.ts';
import { contextFor, outlineOf } from './player.ts';
import { settled } from './ready.ts';

/**
 * Each scene at its last beat as a 1920×1080 page: what the renderer prints as the deck's PDF.
 */
export async function showPrint(root: HTMLElement, config: ViewerConfig): Promise<boolean> {
  document.documentElement.classList.add('tobos-print');
  const outline = outlineOf(config.manifest);
  const scenes = config.manifest.chapters.flatMap((chapter) => chapter.scenes);
  for (const [index, scene] of scenes.entries()) {
    const module = (await import(/* @vite-ignore */ scene.module)) as SceneModule;
    const beats = outline.scenes[index]!.beats;
    const beat = beats.length - 1;
    const page = document.createElement('section');
    page.className = 'tobos-page tobos-stage';
    page.dataset.position = `${scene.id}/${beats[beat]}`;
    root.append(page);
    mount(module.default, {
      target: page,
      props: { beat: beats[beat]!, index: beat },
      context: new Map([[DECK_CONTEXT, contextFor(config.manifest, index)]]),
    });
    flushSync();
    await mediaKnowTheirLength(page);
    new SceneTimeline(page, module.beats).show(beat, false);
  }
  return settled(root, 30_000);
}
