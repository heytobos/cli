import { videoFramesReady } from '../video.ts';

/** Wait until what is on screen is fully drawn: fonts, images, video frames. */
export async function settled(root: HTMLElement, timeout = 10_000): Promise<void> {
  let timer = 0;
  const work = (async () => {
    await document.fonts?.ready;
    const images = [...root.querySelectorAll('img')].filter((img) => !img.complete);
    await Promise.all(images.map((img) => img.decode().catch(() => undefined)));
    // A video that was just sought shows its old frame until the seek is done. Waiting for
    // "loadeddata" alone, as this once did, never returns after a seek: it fires only once.
    await videoFramesReady(root);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  })();
  await Promise.race([work, new Promise((r) => (timer = window.setTimeout(r, timeout)))]);
  window.clearTimeout(timer);
}
