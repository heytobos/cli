/**
 * What a share link's contents (contents.ts) draw with Svelte: a row's step dots, the deck page's
 * BeatStrip, and the props a preview's scene steps by (previews.ts), as the stage's are.
 */
import BeatStrip from '@tobos/site/BeatStrip.svelte';
import { mount, unmount } from 'svelte';
import type { SceneProps } from '../index.ts';

/** A scene's props, which a preview steps as the stage steps its scenes. */
export function sceneProps(beat: string, index: number): SceneProps {
  const props = $state<SceneProps>({ beat, index });
  return props;
}

/** A row's step dots: the scene on stage at its step, a step shown in a preview. */
export interface Strip {
  set: (state: { on: boolean; current: number; pointed: number }) => void;
  destroy: () => void;
}

/** The dots for `beats` in `target`; `show` is a dot clicked, by its step. */
export function strip(target: HTMLElement, beats: string[], show: (step: number) => void): Strip {
  const props = $state({
    beats,
    on: false,
    current: null as string | null,
    pointed: -1,
    title: (_: string, k: number) => `Step ${k + 1}`,
    label: (_: string, k: number) => `Step ${k + 1}`,
    show: (beat: string) => show(beats.indexOf(beat)),
    summary: `${beats.length} steps`,
  });
  const instance = mount(BeatStrip, { target, props });
  return {
    set: ({ on, current, pointed }) => {
      props.on = on;
      props.current = on ? (beats[current] ?? null) : null;
      props.pointed = pointed;
    },
    destroy: () => void unmount(instance),
  };
}
