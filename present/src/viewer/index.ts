import { mount } from 'svelte';
import { setJoin, setMedia } from '../registry.ts';
import { followResponses, setActivities } from '../responses.svelte.ts';
import { viewFromUrl, type ViewerConfig } from './config.ts';
import { showDeck } from './deck-view.ts';
import Presenter from './Presenter.svelte';
import { showPrint } from './print.ts';

export type { ViewerConfig, View } from './config.ts';

/** Start the viewer page: one of the deck views, the presenter, or print. */
export function start(config: ViewerConfig) {
  setMedia(config.manifest.media);
  setActivities(config.manifest);
  setJoin(config.join);
  const root = document.getElementById('tobos')!;
  const view = viewFromUrl();
  // A presenter's link sees what the room answers: the show's windows, and the preview on the
  // deck's page. Print and render are documents, so they show zeros.
  if (config.responses && view !== 'print' && view !== 'render') followResponses(config.responses);
  document.documentElement.dataset.view = view;
  document.title = config.manifest.title;
  if (view === 'presenter') {
    mount(Presenter, { target: root, props: { config } });
  } else if (view === 'print') {
    const ready = showPrint(root, config);
    (window as unknown as { __tobos: unknown }).__tobos = { ready };
  } else {
    showDeck(root, config, view);
  }
}
