/**
 * What the room has answered, for the projector: the audience and presenter windows, and the
 * preview on the deck's page, follow it from the server. Print and render, and a link that isn't
 * a presenter's, have zeros. It is live data, which the position can't recreate.
 */
import type { Activity, Manifest } from '@tobos/deck/types';
import type { Results } from './activities.ts';

/** One activity's responses in the current show. */
export interface Responses {
  /** People whose phones opened the deck's join link during this show. */
  readonly joined: number;
  /** People who have answered this activity during this show. */
  readonly answered: number;
  /** A poll's responses per option, in the order the scene declares them. A form's is empty. */
  readonly counts: number[];
}

const results = $state<Results>({ show: null, joined: 0, activities: {} });
let declared = new Map<string, Activity>();

/** The deck's activities, so a poll nobody answered yet has a zero per option. */
export function setActivities(manifest: Manifest) {
  declared = new Map(
    manifest.chapters.flatMap((c) =>
      c.scenes.flatMap((s) => (s.activity ? [[s.activity.id, s.activity] as const] : [])),
    ),
  );
}

/** The current show's responses: reactive, for a scene or the presenter's view. */
export function liveResults(): Readonly<Results> {
  return results;
}

/**
 * The room's responses to an activity of this deck in the current show: how many joined, how
 * many answered, and a poll's counts per option. Call during component setup.
 */
export function useResponses(id: string): Responses {
  return {
    get joined() {
      return results.joined;
    },
    get answered() {
      return results.activities[id]?.answered ?? 0;
    },
    get counts() {
      const counts = results.activities[id]?.counts;
      const activity = declared.get(id);
      if (activity?.kind !== 'choice') return [];
      return activity.options.map((_, i) => counts?.[i] ?? 0);
    },
  };
}

/** Follow the server's results stream (server-sent events) until the returned function is called. */
export function followResponses(url: string): () => void {
  const source = new EventSource(url);
  source.addEventListener('results', (event) => {
    const next = JSON.parse((event as MessageEvent<string>).data) as Results;
    results.show = next.show;
    results.joined = next.joined;
    results.activities = next.activities;
  });
  return () => source.close();
}
