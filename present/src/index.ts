/**
 * @tobos/present: what a scene imports from the engine.
 */
import type { gsap } from 'gsap';
import { getContext } from 'svelte';
import { mediaUrl } from './registry.ts';

export { playVideo, type PlayVideoOptions } from './video.ts';

/** Finds elements inside the current scene only. */
export type Query = (selector: string) => Element[];

/** One click's worth of a scene: an ID, and the animation into it. */
export interface Beat {
  id: string;
  /** Add the animation into this beat to the scene's timeline. */
  enter?: (tl: gsap.core.Timeline, q: Query) => unknown;
}

/** The props the engine passes to every scene. */
export interface SceneProps {
  /** The current beat's ID. */
  beat: string;
  /** The current beat's index in the scene, from 0. */
  index: number;
}

/** Where a scene sits in the deck, for layouts that show it (a wayfinder, an agenda). */
export interface DeckContext {
  title: string;
  chapters: { id: string; title: string; scenes: { id: string; title: string }[] }[];
  chapter: { id: string; title: string };
  scene: { id: string; title: string };
}

export const DECK_CONTEXT = 'tobos:deck';

/** The deck, its chapters and the current scene. Call during component setup. */
export function useDeck(): DeckContext {
  return getContext<DeckContext>(DECK_CONTEXT);
}

/** The URL of a file in the deck's media/ folder. The name must be a string literal. */
export function media(name: string): string {
  return mediaUrl(name);
}
