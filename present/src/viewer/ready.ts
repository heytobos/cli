import { videoFramesReady } from '../playback.ts';

/**
 * Wait until what is on screen is fully drawn: fonts, images, video frames. True when it is;
 * false when `timeout` came first, and then it says so in the console too. `tobos render` and
 * `tobos export pdf` report a false (cli/src/render.ts).
 */
export async function settled(root: HTMLElement, timeout = 10_000): Promise<boolean> {
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
  const drawn = await Promise.race([
    work.then(() => true),
    new Promise<boolean>((r) => (timer = window.setTimeout(() => r(false), timeout))),
  ]);
  window.clearTimeout(timer);
  if (!drawn)
    console.warn(
      `[tobos] Not everything on screen was drawn within ${timeout / 1000} s: fonts, images or video frames still loading.`,
    );
  return drawn;
}
