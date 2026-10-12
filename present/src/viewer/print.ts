import { flushSync, mount } from 'svelte';
import { DECK_CONTEXT } from '../index.ts';
import type { SceneModule } from '../stage.svelte.ts';
import { SceneTimeline } from '../timeline.ts';
import { videosKnowTheirLength } from '../video.ts';
import type { ViewerConfig } from './config.ts';
import { contextFor, outlineOf } from './player.ts';
import { settled } from './ready.ts';

/**
 * Every beat's end state as a 1920×1080 page, for PDF export. `?beats=last` prints only each
 * scene's last beat (handouts).
 */
export async function showPrint(root: HTMLElement, config: ViewerConfig) {
  document.documentElement.classList.add('tobos-print');
  const onlyLast = new URLSearchParams(location.search).get('beats') === 'last';
  const outline = outlineOf(config.manifest);
  const scenes = config.manifest.chapters.flatMap((chapter) => chapter.scenes);
  for (const [index, scene] of scenes.entries()) {
    const module = (await import(/* @vite-ignore */ scene.module)) as SceneModule;
    const beats = outline.scenes[index]!.beats;
    for (let beat = onlyLast ? beats.length - 1 : 0; beat < beats.length; beat++) {
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
      await videosKnowTheirLength(page);
      new SceneTimeline(page, module.beats).show(beat, false);
    }
  }
  await settled(root, 30_000);
}
