/**
 * How what opens moves: a menu or popover grows out of what opened it, from the edge that meets
 * it, at its middle, and closes by fading. In a narrow window (SHEET) a sheet rises from the foot
 * instead, and a swipe down closes it (pullToClose). Under reduced motion only the fades stay. In
 * --t-ui on --ease, the tokens' own (VOICE.md, Motion). The design system's Menu · opening shows
 * it (brand/system, #p-menu-motion). The app's menus and a share link's contents use it.
 */
import { cubicOut } from 'svelte/easing';
import type { TransitionConfig } from 'svelte/transition';

/**
 * Where a menu is a sheet from the foot rather than a popover by what opened it: a window under
 * 640px wide, whatever points at it. The window decides the shape, the input how it is used (a
 * finger gets 48px rows either way, system.css).
 */
export const SHEET = '(width < 640px)';

/** Whether a menu opened now is a sheet. */
export const isSheet = () => matchMedia(SHEET).matches;

/** A box on the screen: a trigger's, a row's, or a pointer's point, whose sides meet. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The scale it grows from. */
const FROM = 0.95;

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** --t-ui in milliseconds, and --ease, as tokens.css has them. */
function tokens() {
  const css = getComputedStyle(document.documentElement);
  const t = css.getPropertyValue('--t-ui').trim();
  const ms = t.endsWith('ms') ? parseFloat(t) : parseFloat(t) * 1000;
  return {
    ms: Number.isFinite(ms) ? ms : 300,
    ease: css.getPropertyValue('--ease').trim() || 'cubic-bezier(0.22, 0.61, 0.24, 1)',
  };
}

/**
 * What `el` is in, grown to its size at once: measured while a popover around it still grows, it
 * would be where the popover is now, and what is fixed in it would hang from the popover, not the
 * screen, as a level's menu does in Share's panel.
 */
export function settleAround(el: Element) {
  for (const a of document.getAnimations()) {
    const target = (a.effect as KeyframeEffect | null)?.target;
    if (target && target !== el && target.contains(el)) a.finish();
  }
}

/** A point as a box, as a right-click's menu opens from it. */
export const pointBox = (x: number, y: number): Box => ({ left: x, top: y, right: x, bottom: y });

/**
 * Where a popup grows from, in its own coordinates: the edge of it that meets what opened it
 * (`from`), at that thing's middle. Below it, its top edge; flipped above, its bottom; beside it,
 * as a submenu is its row, the side that touches.
 */
export function originOf(box: Box, from: Box) {
  const w = box.right - box.left;
  const h = box.bottom - box.top;
  const clamp = (v: number, hi: number) => Math.min(Math.max(v, 0), hi);
  const below = box.top >= from.bottom - 2;
  const above = box.bottom <= from.top + 2;
  const beside = !below && !above;
  return {
    x:
      beside && box.left >= from.right - 2
        ? 0
        : beside && box.right <= from.left + 2
          ? w
          : clamp((from.left + from.right) / 2 - box.left, w),
    y: below ? 0 : above ? h : clamp((from.top + from.bottom) / 2 - box.top, h),
  };
}

/**
 * `el`, where it now is (`box`), grows out of `from`. No fill: once grown its transform is none
 * again, so what is fixed inside it (a submenu, Share's level menu) places itself by the screen.
 */
export function grow(el: HTMLElement, box: Box, from: Box) {
  if (!el.animate) return;
  const { ms, ease } = tokens();
  if (reduced())
    return void el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: ease });
  const o = originOf(box, from);
  el.style.transformOrigin = `${o.x}px ${o.y}px`;
  el.animate(
    [
      { opacity: 0, transform: `scale(${FROM})` },
      { opacity: 1, transform: 'none' },
    ],
    { duration: ms, easing: ease },
  );
}

/** `el` grown out of `from` where it was drawn, as a popover placed by CSS is. */
export function growHere(el: HTMLElement, from: Box) {
  grow(el, el.getBoundingClientRect(), from);
}

/** A sheet rising from the foot of the screen; under reduced motion, fading in. */
export function rise(el: HTMLElement) {
  if (!el.animate) return;
  const { ms, ease } = tokens();
  el.animate(
    reduced()
      ? [{ opacity: 0 }, { opacity: 1 }]
      : [{ transform: 'translateY(100%)' }, { transform: 'none' }],
    {
      duration: ms,
      easing: ease,
    },
  );
}

/** A scrim fading in. */
export function dim(el: HTMLElement) {
  if (!el.animate) return;
  const { ms, ease } = tokens();
  el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ms, easing: ease });
}

/**
 * What a sheet shows, swapped in place: in from the right going in (a submenu), from the left
 * coming back; under reduced motion, fading in.
 */
export function slide(els: Iterable<Element>, back: boolean) {
  const { ms, ease } = tokens();
  const keys = reduced()
    ? [{ opacity: 0 }, { opacity: 1 }]
    : [
        { opacity: 0, transform: `translateX(${back ? -24 : 24}px)` },
        { opacity: 1, transform: 'none' },
      ];
  for (const el of els) (el as HTMLElement).animate?.(keys, { duration: ms, easing: ease });
}

/**
 * The transition it closes with (`out:vanish`): a fade in half the time, not shrinking; a sheet
 * (`{ sheet: true }`) sinks back to the foot instead.
 */
export function vanish(el: Element, { sheet = false }: { sheet?: boolean } = {}): TransitionConfig {
  const { ms } = tokens();
  const transform = getComputedStyle(el).transform;
  const pulled =
    transform && transform !== 'none' && typeof DOMMatrixReadOnly === 'function'
      ? new DOMMatrixReadOnly(transform).m42
      : 0;
  const sink = sheet && !reduced();
  return {
    duration: ms / 2,
    easing: cubicOut,
    // A sheet pulled part way down sinks on from there.
    css: (t) =>
      sink ? `transform: translateY(calc(${(1 - t) * 100}% + ${t * pulled}px))` : `opacity: ${t}`,
  };
}

/** Past this much of its height, a sheet pulled down closes; short of it, it springs back. */
const PULL = 1 / 4;
/** A flick: faster than this, px/ms, at release, closes it however short the pull. */
const FLICK = 0.4;
/** A finger still this long, ms, before it lets go made no flick, however fast it moved before. */
const HELD = 100;

/**
 * A sheet that a finger pulls down from its top closes: `sheet`, which scrolls, scrolled to its
 * start. Past a quarter of its height, or on a flick, `close` is called with the sheet where the
 * finger left it (vanish and sink take it from there); short of that, it springs back in half of
 * --t-ui, or at once under reduced motion. Returns what takes it off.
 */
export function pullToClose(sheet: HTMLElement, close: () => void): () => void {
  let pull: { y: number; at: number; dy: number; v: number } | null = null;
  /** Back to where it was, short of closing. */
  const back = () => {
    const from = sheet.style.transform;
    sheet.style.transform = '';
    if (reduced() || !from) return;
    const { ms, ease } = tokens();
    sheet.animate?.([{ transform: from }, { transform: 'none' }], {
      duration: ms / 2,
      easing: ease,
    });
  };
  const start = (e: TouchEvent) => {
    // A second finger ends a pull under way: the sheet goes back.
    if (pull && pull.dy > 0) back();
    pull =
      sheet.scrollTop <= 0 && e.touches.length === 1
        ? { y: e.touches[0]!.clientY, at: performance.now(), dy: 0, v: 0 }
        : null;
  };
  const move = (e: TouchEvent) => {
    if (!pull) return;
    const dy = e.touches[0]!.clientY - pull.y;
    // Up first: the list's own scroll.
    if (dy <= 0 && pull.dy <= 0) return void (pull = null);
    e.preventDefault();
    // The finger's speed as it goes, for a flick: the last move's, not the whole pull's.
    const now = performance.now();
    pull.v = (Math.max(0, dy) - pull.dy) / Math.max(1, now - pull.at);
    pull.at = now;
    pull.dy = Math.max(0, dy);
    sheet.style.transform = `translateY(${pull.dy}px)`;
  };
  const end = () => {
    if (!pull) return;
    const { dy, at } = pull;
    const v = performance.now() - at > HELD ? 0 : pull.v;
    pull = null;
    if (dy <= 0) return;
    if (dy > sheet.offsetHeight * PULL || v > FLICK) return close();
    back();
  };
  sheet.addEventListener('touchstart', start, { passive: true });
  sheet.addEventListener('touchmove', move, { passive: false });
  sheet.addEventListener('touchend', end);
  sheet.addEventListener('touchcancel', end);
  return () => {
    sheet.removeEventListener('touchstart', start);
    sheet.removeEventListener('touchmove', move);
    sheet.removeEventListener('touchend', end);
    sheet.removeEventListener('touchcancel', end);
  };
}

/**
 * A sheet sinking back to the foot from where it is (pulled part way down, or not), in half of
 * --t-ui; under reduced motion, fading. For a sheet drawn without Svelte's `out:vanish`.
 */
export function sink(el: HTMLElement): Animation | undefined {
  if (!el.animate) return undefined;
  const { ms, ease } = tokens();
  const from = el.style.transform || 'none';
  el.style.transform = '';
  return el.animate(
    reduced()
      ? [{ opacity: 1 }, { opacity: 0 }]
      : [{ transform: from }, { transform: 'translateY(100%)' }],
    { duration: ms / 2, easing: ease },
  );
}

/** Something that grew fading out, in half of --t-ui. For a popup drawn without `out:vanish`. */
export function fade(el: HTMLElement): Animation | undefined {
  if (!el.animate) return undefined;
  const { ms, ease } = tokens();
  return el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ms / 2, easing: ease });
}
