import type { SharedManifest } from '@tobos/deck';
import type { JoinInfo } from '../registry.ts';

export type View = 'deck' | 'audience' | 'presenter' | 'print' | 'render' | 'sheet';

/** What the viewer page passes to start(). */
export interface ViewerConfig {
  /** The deck's id: names the channel the deck's windows share while it is presented. */
  deck: string;
  rev: string;
  manifest: SharedManifest;
  /**
   * The window's server-sent events (events.ts): pushes for live follow, and to the presenting
   * windows the room's results, to the presenter's view the speaker's notes too; absent in a
   * static folder (the e2e suite's fixture).
   */
  events?: string;
  /** Where the latest manifest is, for live follow. */
  manifestUrl?: string;
  /** The deck's page in the app, where the presenter goes back to when presenting stops. */
  home?: string;
  /** The deck's join code, for `<JoinCode/>`: once the deck has a poll. */
  join?: JoinInfo;
  /**
   * The room's answers come on `events`: the windows of a deck presented, the presenter's and the
   * projector's, and the deck page's preview, which is a projector.
   */
  answers?: true;
  /**
   * Where the presenter reports where they are, that presenting stopped, or a new session. The
   * presenter's view only, whose `events` carry the speaker's notes too.
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

/** Changes to the address in 10 seconds: Safari takes 100, and then throws. */
const WINDOW_MS = 10_000;
const MOST = 90;
/** When the address changed in the last 10 seconds; the position waiting for room, if any. */
const writtenAt: number[] = [];
let waiting: string | undefined;
let retry: ReturnType<typeof setTimeout> | undefined;

/**
 * The position in the address bar. Safari throws past 100 changes to it in 10 seconds, which an
 * arrow key held down reaches in three, and the move after it would never reach the stage: past
 * 90, a move waits for room, and of those waiting only the last is written. One the browser
 * refuses all the same is left for the next.
 */
export function showHash(hash: string) {
  waiting = hash;
  const now = Date.now();
  while (writtenAt.length > 0 && now - writtenAt[0]! >= WINDOW_MS) writtenAt.shift();
  if (writtenAt.length >= MOST) {
    retry ??= setTimeout(
      () => {
        retry = undefined;
        if (waiting !== undefined) showHash(waiting);
      },
      writtenAt[0]! + WINDOW_MS - now,
    );
    return;
  }
  waiting = undefined;
  if (location.hash === hash) return;
  writtenAt.push(now);
  try {
    history.replaceState(null, '', `${location.pathname}${location.search}${hash}`);
  } catch {
    // A limit of the browser's own: the next move writes it.
  }
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
