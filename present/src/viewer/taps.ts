const INTERACTIVE = 'a, button, input, textarea, select, label, [data-interactive]';

/**
 * Step by clicking or tapping: the left third goes back, the rest forward.
 * Clicks on links, buttons and anything marked data-interactive are the scene's own.
 */
export function onTap(element: HTMLElement, step: (delta: 1 | -1) => void): () => void {
  const handler = (event: PointerEvent) => {
    if (event.button !== 0) return;
    if ((event.target as Element | null)?.closest?.(INTERACTIVE)) return;
    if (window.getSelection()?.toString()) return;
    const { left, width } = element.getBoundingClientRect();
    step(event.clientX - left < width / 3 ? -1 : 1);
  };
  element.addEventListener('pointerup', handler);
  return () => element.removeEventListener('pointerup', handler);
}
