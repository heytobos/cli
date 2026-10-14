import type { Manifest } from '@tobos/deck';
import type { JoinInfo } from '../registry.ts';

export type View = 'deck' | 'audience' | 'presenter' | 'print' | 'render';

/** What the viewer page passes to start(). */
export interface ViewerConfig {
  /** The deck's id: names the presenting session. */
  deck: string;
  rev: string;
  manifest: Manifest;
  /** Server-sent events for live follow; absent in a static folder (the e2e suite's fixture). */
  events?: string;
  /** Where the latest manifest is, for live follow. */
  manifestUrl?: string;
  /** The deck's page in the app, where the presenter goes back to when the show ends. */
  home?: string;
  /** The deck's join code, for `<JoinCode/>`: once the deck has an activity. */
  join?: JoinInfo;
  /** Where the presenter reports the show's position: on a presenter's link only. */
  live?: string;
  /** The room's responses, as server-sent events, for the projector: on a presenter's link only. */
  responses?: string;
  /**
   * A share link's page, for people outside the deck's account: the deck to click through, and
   * its PDF to download (`pdf`, where the server makes them). Never presented, never in sync with
   * another window.
   */
  shared?: { pdf?: string };
}

/** The view the URL asks for. A share link is only ever clicked through, or printed. */
export function viewFromUrl(shared = false): View {
  const view = new URLSearchParams(location.search).get('view');
  if (shared) return view === 'print' ? 'print' : 'deck';
  return view === 'audience' || view === 'presenter' || view === 'print' || view === 'render'
    ? view
    : 'deck';
}

/** The same page in another view, keeping the position. */
export function urlForView(view: View): string {
  const url = new URL(location.href);
  if (view === 'deck') url.searchParams.delete('view');
  else url.searchParams.set('view', view);
  return url.href;
}
