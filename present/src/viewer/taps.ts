const INTERACTIVE = 'a, button, input, textarea, select, label, [data-interactive]';

/** How far a pointer may move between down and up and still tap, in CSS pixels. */
const SLOP = 10;
/** How far a finger moves sideways for a swipe, in CSS pixels. */
const SWIPE = 40;

const interactive = (target: EventTarget | null) =>
  Boolean((target as Element | null)?.closest?.(INTERACTIVE));

/**
 * Step by clicking or tapping: the left third goes back, the rest forward.
 * Clicks on links, buttons and anything marked data-interactive are the scene's own, and a pointer
 * that moved on the way is a swipe or a drag, not a tap.
 */
export function onTap(element: HTMLElement, step: (delta: 1 | -1) => void): () => void {
  let down: { x: number; y: number } | null = null;
  const onDown = (event: PointerEvent) => (down = { x: event.clientX, y: event.clientY });
  const onUp = (event: PointerEvent) => {
    const from = down;
    down = null;
    if (event.button !== 0) return;
    if (interactive(event.target)) return;
    if (window.getSelection()?.toString()) return;
    if (from && Math.hypot(event.clientX - from.x, event.clientY - from.y) > SLOP) return;
    const { left, width } = element.getBoundingClientRect();
    step(event.clientX - left < width / 3 ? -1 : 1);
  };
  element.addEventListener('pointerdown', onDown);
  element.addEventListener('pointerup', onUp);
  return () => {
    element.removeEventListener('pointerdown', onDown);
    element.removeEventListener('pointerup', onUp);
  };
}

/**
 * Step by swiping one finger sideways: to the left goes forward, to the right back. More up or down
 * than sideways is a scroll, of the page around a preview; two fingers, or one on a slide zoomed
 * in, are the browser's. Touch events, not pointer ones: the browser takes a moving finger to pan
 * (touch-action: manipulation, which keeps the pinch zoom), cancels its pointer and never sends
 * its pointerup, but the touch's end still comes.
 */
export function onSwipe(element: HTMLElement, step: (delta: 1 | -1) => void): () => void {
  let start: { x: number; y: number } | null = null;
  const onStart = (event: TouchEvent) => {
    const touch = event.touches.length === 1 ? event.touches[0] : undefined;
    start = touch && !interactive(event.target) ? { x: touch.clientX, y: touch.clientY } : null;
  };
  const onEnd = (event: TouchEvent) => {
    const touch = event.changedTouches[0];
    const from = start;
    start = null;
    if (!from || !touch || event.touches.length) return;
    if ((window.visualViewport?.scale ?? 1) > 1.01) return;
    const dx = touch.clientX - from.x;
    const dy = touch.clientY - from.y;
    if (Math.abs(dx) < SWIPE || Math.abs(dx) < 2 * Math.abs(dy)) return;
    step(dx < 0 ? 1 : -1);
  };
  const onCancel = () => (start = null);
  element.addEventListener('touchstart', onStart, { passive: true });
  element.addEventListener('touchend', onEnd);
  element.addEventListener('touchcancel', onCancel);
  return () => {
    element.removeEventListener('touchstart', onStart);
    element.removeEventListener('touchend', onEnd);
    element.removeEventListener('touchcancel', onCancel);
  };
}
