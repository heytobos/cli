import type { SharedManifest } from '@tobos/deck';
import type { JoinInfo } from '../registry.ts';

export type View = 'deck' | 'audience' | 'presenter' | 'print' | 'render' | 'sheet';

/** What the viewer page passes to start(). */
export interface ViewerConfig {
  /** The deck's id: names the presenting session. */
  deck: string;
  rev: string;
  manifest: SharedManifest;
  /**
   * The window's server-sent events (events.ts): pushes for live follow, and to a show's windows
   * the room's results, to the presenter's view the speaker's notes too; absent in a static folder
   * (the e2e suite's fixture).
   */
  events?: string;
  /** Where the latest manifest is, for live follow. */
  manifestUrl?: string;
  /** The deck's page in the app, where the presenter goes back to when the show ends. */
  home?: string;
  /** The deck's join code, for `<JoinCode/>`: once the deck has an activity. */
  join?: JoinInfo;
  /**
   * The room's answers come on `events`: a show's windows, the presenter's and the projector's,
   * and the deck page's preview, which is a projector.
   */
  answers?: true;
  /**
   * Where the presenter reports the show: its position, its end, a new session. The presenter's
   * view only, whose `events` carry the speaker's notes too.
   */
  live?: string;
  /** The projector's link, which the presenter's view opens it with: its own, made with it. */
  projector?: string;
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
  return view === 'audience' ||
    view === 'presenter' ||
    view === 'print' ||
    view === 'render' ||
    view === 'sheet'
    ? view
    : 'deck';
}

/** The position in the address bar. */
export function showHash(hash: string) {
  if (location.hash !== hash)
    history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
}

/**
 * The projector's window at `hash`: at its own link, which the presenter's view carries, or, in a
 * static folder, at the same page in the audience view.
 */
export function projectorUrl(config: ViewerConfig, hash: string): string {
  if (config.projector) return `${config.projector}${hash}`;
  const url = new URL(location.href);
  url.searchParams.set('view', 'audience');
  url.hash = hash;
  return url.href;
}
