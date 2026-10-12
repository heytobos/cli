import { mount } from 'svelte';
import { setMedia } from '../registry.ts';
import { viewFromUrl, type ViewerConfig } from './config.ts';
import { showDeck } from './deck-view.ts';
import Presenter from './Presenter.svelte';
import { showPrint } from './print.ts';

export type { ViewerConfig, View } from './config.ts';

/** Start the viewer page: one of the deck views, the presenter, or print. */
export function start(config: ViewerConfig) {
  setMedia(config.manifest.media);
  const root = document.getElementById('tobos')!;
  const view = viewFromUrl();
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
