import type { Manifest } from '@tobos/deck';

export type View = 'deck' | 'audience' | 'presenter' | 'print' | 'render';

/** What the viewer page passes to start(). */
export interface ViewerConfig {
  /** "account/deck": names the presenting session. */
  deck: string;
  rev: string;
  manifest: Manifest;
  /** Server-sent events for live follow; absent in a static folder (the e2e suite's fixture). */
  events?: string;
  /** Where the latest manifest is, for live follow. */
  manifestUrl?: string;
}

export function viewFromUrl(): View {
  const view = new URLSearchParams(location.search).get('view');
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
