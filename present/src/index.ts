/**
 * @tobos/present: what a scene imports from the engine.
 */
import type { gsap } from 'gsap';
import { getContext, type Component } from 'svelte';
import JoinCodeComponent from './JoinCode.svelte';
import { joinInfo, mediaUrl, type JoinInfo } from './registry.ts';

export { playAudio, playVideo, type PlayAudioOptions, type PlayVideoOptions } from './playback.ts';
export { useResponses, type Responses } from './responses.svelte.ts';
export type { Activity, ChoiceActivity, TextActivity, TextField } from '@tobos/deck/types';

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

/**
 * The URL of a file in media/, as revisions of format 1 call it: they still run as pushed. A deck
 * now imports the file, `import cow from '$media/cow.jpg'`, and the check refuses a call.
 *
 * @deprecated `import cow from '$media/cow.jpg'`
 * @internal
 */
export function media(name: string): string {
  return mediaUrl(name);
}

export type { JoinInfo } from './registry.ts';

/**
 * The deck's join code, for a scene to show its own way: the digits, the link as people type
 * it, the full URL, and the QR code as an image's address. Undefined while the deck has no
 * activity.
 */
export function useJoin(): JoinInfo | undefined {
  return joinInfo();
}

export interface JoinCodeProps {
  /** The QR code's width and height, in stage pixels. */
  size?: number;
}

/**
 * The deck's join code: a QR code, and under it the link it holds, which phones open to answer
 * the deck's activities. The scene sizes it; the link takes the scene's font.
 */
export const JoinCode = JoinCodeComponent as unknown as Component<JoinCodeProps>;
