import type { Manifest } from '@tobos/deck';
import { setMedia } from '../registry.ts';
import { setActivities } from '../responses.svelte.ts';
import type { ViewerConfig } from './config.ts';
import type { Player } from './player.ts';

/**
 * Follow pushes: the server sends an event per new revision; changed scenes swap in at the
 * current position, anything else reloads the page (which keeps the position in its hash).
 */
export function follow(
  config: ViewerConfig,
  players: () => Player[],
  onUpdate?: (rev: string) => void,
) {
  if (!config.events || !config.manifestUrl) return () => {};
  const source = new EventSource(config.events);
  let rev = config.rev;
  let busy: Promise<void> = Promise.resolve();
  source.addEventListener('push', (event) => {
    const data = JSON.parse((event as MessageEvent<string>).data) as { rev: string };
    if (data.rev === rev) return;
    busy = busy.then(async () => {
      const response = await fetch(config.manifestUrl!, { cache: 'no-store' });
      if (!response.ok) return;
      const next = (await response.json()) as Manifest & { rev?: string };
      rev = data.rev;
      setMedia(next.media);
      setActivities(next);
      for (const player of players()) {
        const result = await player.update(next, new URL(config.manifestUrl!, location.href).href);
        if (result === 'reload') {
          location.reload();
          return;
        }
      }
      onUpdate?.(rev);
    });
    // A failed update (a network blip, a server restart) must not reject the chain, or every
    // later push would be skipped.
    busy = busy.catch((error) => console.warn('[tobos] live update failed', error));
  });
  return () => source.close();
}
