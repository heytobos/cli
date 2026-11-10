export const STAGE_WIDTH = 1920;
export const STAGE_HEIGHT = 1080;

/**
 * Create a 1920×1080 stage inside `container`, scaled to fit and centred with bars, or set in its
 * top left corner (`start`), as the presenter's view has its slides under their labels. Its scale
 * is the stage's `--tobos-scale`, so a frame drawn on it can stay a pixel wide.
 * Offsets are rounded to whole device pixels, so edges stay crisp (Safari draws hairlines otherwise).
 */
export function letterbox(
  container: HTMLElement,
  align: 'center' | 'start' = 'center',
): { stage: HTMLElement; destroy: () => void } {
  container.classList.add('tobos-letterbox');
  const stage = document.createElement('div');
  stage.className = 'tobos-stage';
  container.append(stage);
  const fit = () => {
    const { width, height } = container.getBoundingClientRect();
    const scale = Math.min(width / STAGE_WIDTH, height / STAGE_HEIGHT);
    const dpr = window.devicePixelRatio || 1;
    // The share of the room left over that goes before the stage: half, or none.
    const before = align === 'center' ? 1 / 2 : 0;
    const x = Math.round((width - STAGE_WIDTH * scale) * before * dpr) / dpr;
    const y = Math.round((height - STAGE_HEIGHT * scale) * before * dpr) / dpr;
    stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    stage.style.setProperty('--tobos-scale', String(scale));
  };
  const observer = new ResizeObserver(fit);
  observer.observe(container);
  fit();
  return {
    stage,
    destroy: () => {
      observer.disconnect();
      stage.remove();
    },
  };
}
