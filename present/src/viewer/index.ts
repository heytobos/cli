import { mount } from 'svelte';
import { setJoin, setMedia, setShared } from '../registry.ts';
import { followResponses, setActivities } from '../responses.svelte.ts';
import { viewFromUrl, type ViewerConfig } from './config.ts';
import { showDeck } from './deck-view.ts';
import Presenter from './Presenter.svelte';
import { showPrint } from './print.ts';
import { showSheet } from './sheet.ts';

export type { ViewerConfig, View } from './config.ts';

/** Start the viewer page: one of the deck views, the presenter, print, or a sheet of its media. */
export function start(config: ViewerConfig) {
  setMedia(config.manifest.media);
  setActivities(config.manifest);
  setJoin(config.join);
  setShared(Boolean(config.shared));
  const root = document.getElementById('tobos')!;
  const view = viewFromUrl(Boolean(config.shared));
  // A presenter's link sees what the room answers: the show's windows, and the preview on the
  // deck's page. Print and render are documents, so they show zeros.
  if (config.responses && view !== 'print' && view !== 'render' && view !== 'sheet')
    followResponses(config.responses);
  document.documentElement.dataset.view = view;
  document.title = config.manifest.title;
  if (view === 'presenter') {
    mount(Presenter, { target: root, props: { config } });
  } else if (view === 'print') {
    // Whether every page was drawn in time (settled): the renderer waits for it.
    const ready = showPrint(root, config);
    (window as unknown as { __tobos: unknown }).__tobos = { ready };
  } else if (view === 'sheet') {
    (window as unknown as { __tobos: unknown }).__tobos = { ready: showSheet(root, config) };
  } else {
    showDeck(root, config, view);
  }
}
