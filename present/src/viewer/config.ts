import type { Manifest } from '@tobos/deck';
import type { JoinInfo } from '../registry.ts';

export type View = 'deck' | 'audience' | 'presenter' | 'print' | 'render' | 'sheet';

/** What the viewer page passes to start(). */
export interface ViewerConfig {
  /** The deck's id: names the presenting session. */
  deck: string;
  rev: string;
  manifest: Manifest;
  /**
   * The window's server-sent events (events.ts): pushes for live follow, and on a presenter's link
   * the room's results and the speaker's notes; absent in a static folder (the e2e suite's fixture).
   */
  events?: string;
  /** Where the latest manifest is, for live follow. */
  manifestUrl?: string;
  /** The deck's page in the app, where the presenter goes back to when the show ends. */
  home?: string;
  /** The deck's join code, for `<JoinCode/>`: once the deck has an activity. */
  join?: JoinInfo;
  /**
   * Where the presenter reports the show's position: on a presenter's link only, whose `events`
   * also carry the room's results and the speaker's notes.
   */
  live?: string;
  /**
   * A share link's page, for people outside the deck's account: the deck to click through, and
   * its PDF to download (`pdf`, where the server makes them). Never presented, never in sync with
   * another window.
   */
  shared?: { pdf?: string };
  /**
   * Where this window gets a new link to the deck, in a view: the one in the address bar opens
   * once. Absent in a static folder, whose address opens as often as it likes.
   */
  link?: string;
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

/**
 * The position in the address bar. Spelled out, since a bare `#hash` goes beside the page's base,
 * and a page opened by a link that opens once has its window's folder for one (content.ts).
 */
export function showHash(hash: string) {
  if (location.hash !== hash)
    history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
}

/**
 * The same page in another view, at `hash`: by default the position it is at. A new link, which
 * opens once, is on its way; a static folder's address is there at once, so a window opens on it
 * rather than empty first.
 */
export function urlForView(
  config: ViewerConfig,
  view: View,
  hash = location.hash,
): string | Promise<string> {
  if (config.link) return newLink(config.link, view, hash);
  const url = new URL(location.href);
  if (view === 'deck') url.searchParams.delete('view');
  else url.searchParams.set('view', view);
  url.hash = hash;
  return url.href;
}

async function newLink(link: string, view: View, hash: string): Promise<string> {
  const response = await fetch(link, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ view: view === 'deck' ? undefined : view }),
  });
  if (!response.ok) throw new Error(`No link for the ${view} view: ${response.status}`);
  return `${((await response.json()) as { url: string }).url}${hash}`;
}

/**
 * The page again, as a push it can't swap in asks: at a new link where the one in the address bar
 * opens once, which works in a frame the browser keeps nothing for too.
 */
export async function reload(config: ViewerConfig) {
  if (!config.link) return location.reload();
  const view = new URLSearchParams(location.search).get('view');
  location.replace(await newLink(config.link, (view ?? 'deck') as View, location.hash));
}
