export const STAGE_WIDTH = 1920;
export const STAGE_HEIGHT = 1080;

/**
 * Create a 1920×1080 stage inside `container`, scaled to fit and centred with bars.
 * Offsets are rounded to whole device pixels, so edges stay crisp (Safari draws hairlines otherwise).
 */
export function letterbox(container: HTMLElement): { stage: HTMLElement; destroy: () => void } {
  container.classList.add('tobos-letterbox');
  const stage = document.createElement('div');
  stage.className = 'tobos-stage';
  container.append(stage);
  const fit = () => {
    const { width, height } = container.getBoundingClientRect();
    const scale = Math.min(width / STAGE_WIDTH, height / STAGE_HEIGHT);
    const dpr = window.devicePixelRatio || 1;
    const x = Math.round(((width - STAGE_WIDTH * scale) / 2) * dpr) / dpr;
    const y = Math.round(((height - STAGE_HEIGHT * scale) / 2) * dpr) / dpr;
    stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
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
