import type { Manifest } from '@tobos/deck';
import { setMedia } from '../registry.ts';
import { setActivities } from '../responses.svelte.ts';
import type { ViewerConfig } from './config.ts';
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
  const catchUp = () => {
    busy = busy.then(async () => {
      const response = await fetch(manifestUrl, { cache: 'no-store' });
      if (!response.ok) return;
      const next = (await response.json()) as Manifest & { rev?: string };
      if (!next.rev || next.rev === rev) return;
      rev = next.rev;
      setMedia(next.media);
      setActivities(next);
      for (const player of players()) {
        const result = await player.update(next, new URL(manifestUrl, location.href).href);
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
  };
  return stream(
    config.events,
    {
      push: (data) => {
        if ((JSON.parse(data) as { rev: string }).rev !== rev) catchUp();
      },
    },
    (again) => again && catchUp(),
  );
}
