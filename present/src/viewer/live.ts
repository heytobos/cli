import type { Manifest } from '@tobos/deck';
import { setMedia } from '../registry.ts';
import { setActivities } from '../responses.svelte.ts';
import { reload, type ViewerConfig } from './config.ts';
import type { Player } from './player.ts';
import { stream } from './stream.ts';

/**
 * Follow pushes: the server sends an event per new revision; changed scenes swap in at the
 * current position, anything else reloads the page (which keeps the position in its hash). Back
 * from a lost connection, as after a release restarts the server, the latest manifest says
 * whether a push was missed meanwhile.
 */
export function follow(
  config: ViewerConfig,
  players: () => Player[],
  onUpdate?: (rev: string) => void,
) {
  if (!config.events || !config.manifestUrl) return () => {};
  const manifestUrl = config.manifestUrl;
  let rev = config.rev;
  let busy: Promise<void> = Promise.resolve();
  let retry: ReturnType<typeof setTimeout> | undefined;
  let wait = 5000;
  let stopped = false;
  const catchUp = () => {
    busy = busy.then(async () => {
      const response = await fetch(manifestUrl, { cache: 'no-store' });
      if (!response.ok) return;
      const next = (await response.json()) as Manifest & { rev?: string };
      if (!next.rev || next.rev === rev) return;
      const before = rev;
      rev = next.rev;
      setMedia(next.media);
      setActivities(next);
      for (const player of players()) {
        const result = await player.update(next, new URL(manifestUrl, document.baseURI).href);
        if (result === 'reload') {
          // Without a new link to reload at, this push is tried again in a while, longer each
          // time, and on the next connection.
          await reload(config).catch((error: unknown) => {
            rev = before;
            if (!stopped) {
              clearTimeout(retry);
              retry = setTimeout(catchUp, wait);
              wait = Math.min(wait * 2, 60_000);
            }
            throw error;
          });
          return;
        }
      }
      onUpdate?.(rev);
    });
    // A failed update (a network blip, a server restart) must not reject the chain, or every
    // later push would be skipped.
    busy = busy.catch((error) => console.warn('[tobos] live update failed', error));
  };
  const stop = stream(
    config.events,
    {
      push: (data) => {
        if ((JSON.parse(data) as { rev: string }).rev !== rev) catchUp();
      },
    },
    (again) => again && catchUp(),
  );
  return () => {
    stopped = true;
    clearTimeout(retry);
    stop();
  };
}
