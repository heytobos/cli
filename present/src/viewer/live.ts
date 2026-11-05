import type { SharedManifest } from '@tobos/deck';
import { setMedia } from '../registry.ts';
import { setActivities } from '../responses.svelte.ts';
import type { ViewerConfig } from './config.ts';
import type { Player } from './player.ts';
import { listen } from './events.ts';

/**
 * Follow pushes: the server sends an event per new revision, and per change to the deck's outline,
 * with its version (ADR 0006); changed scenes swap in at the current position, an outline changed
 * reorders, hides and renames them in place, anything else reloads the page (which keeps the
 * position in its hash). Back from a lost connection, as after a release restarts the server, the
 * latest manifest says whether a push was missed meanwhile.
 */
export function follow(
  config: ViewerConfig,
  players: () => Player[],
  onUpdate?: (rev: string) => void,
) {
  if (!config.events || !config.manifestUrl) return () => {};
  const manifestUrl = config.manifestUrl;
  let rev = config.rev;
  let outline = config.outline;
  /** Whether what the server has is what this window shows: the same version and outline. */
  const current = (next: { rev?: string; outline?: number }) =>
    next.rev === rev && (next.outline === undefined || next.outline === outline);
  let busy: Promise<void> = Promise.resolve();
  const catchUp = () => {
    busy = busy.then(async () => {
      const response = await fetch(manifestUrl, { cache: 'no-store' });
      if (!response.ok) return;
      const next = (await response.json()) as SharedManifest & { rev?: string; outline?: number };
      if (!next.rev || current(next)) return;
      rev = next.rev;
      outline = next.outline;
      setMedia(next.media);
      setActivities(next);
      for (const player of players()) {
        const result = await player.update(next, new URL(manifestUrl, document.baseURI).href);
        if (result === 'reload') {
          // At the same link, which opens as often as it likes (TOB-404, D3).
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
  const stop = listen(
    config.events,
    'push',
    (data) => {
      if (!current(JSON.parse(data) as { rev: string; outline?: number })) catchUp();
    },
    catchUp,
  );
  return stop;
}
