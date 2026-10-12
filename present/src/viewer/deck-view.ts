import { letterbox } from '../letterbox.ts';
import { formatHash, parseHash, same, START } from '../position.ts';
import { urlForView, type View, type ViewerConfig } from './config.ts';
import { action } from './keys.ts';
import { follow } from './live.ts';
import { Player } from './player.ts';
import { settled } from './ready.ts';
import { joinSession, type BeatRef } from './session.ts';
import { onTap } from './taps.ts';

/**
 * The deck on one stage: the plain view, the audience window, and the view render uses.
 */
export function showDeck(root: HTMLElement, config: ViewerConfig, view: View) {
  const { stage } = letterbox(root);
  const render = view === 'render';
  if (view === 'audience' || render) document.documentElement.classList.add('tobos-no-cursor');

  let session: ReturnType<typeof joinSession> | null = null;
  let currentRev = config.rev;
  const embedded = window.parent !== window;
  // A still on someone else's page (a template's gallery): no black bars around the stage.
  if (render && embedded) document.documentElement.classList.add('tobos-still');
  const player: Player = new Player(stage, config.manifest, {
    mountAhead: !render,
    onMove: (position) => {
      const hash = formatHash(player.outline, position);
      if (location.hash !== hash) history.replaceState(null, '', hash);
      if (!applyingRemote) session?.publish(refOf());
      if (embedded)
        window.parent.postMessage({ type: 'tobos:position', hash, rev: currentRev }, '*');
    },
  });

  let applyingRemote = false;
  const refOf = (): BeatRef => {
    const p = player.position ?? START;
    const scene = player.outline.scenes[p.scene]!;
    return { scene: scene.id, beat: scene.beats[p.beat]! };
  };

  const ready = player.goHash(location.hash);

  // The page around it (a template's gallery) may draw the grid's guides over the stage.
  window.addEventListener('message', (event) => {
    const data = event.data as { type?: string; on?: unknown } | null;
    if (data?.type === 'tobos:guides')
      document.documentElement.classList.toggle('tobos-guides', Boolean(data.on));
  });

  if (render) {
    // The API `tobos render` drives through a headless browser.
    (window as unknown as { __tobos: unknown }).__tobos = {
      ready: ready.then(() => settled(stage)),
      outline: () => player.outline,
      async goto(hash: string) {
        await player.goHash(hash, false);
        await settled(stage);
      },
      async sample(hash: string, progress: number) {
        const position = parseHash(player.outline, hash) ?? START;
        // Frames of one beat in a row: move only for the first, so a video seeks once a frame.
        if (!same(player.position, position)) await player.go(position, false);
        player.stage.shown?.timeline.sample(position.beat, progress);
        await settled(stage);
      },
      duration(hash: string) {
        const position = parseHash(player.outline, hash) ?? START;
        return player.stage.shown?.timeline.duration(position.beat) ?? 0;
      },
    };
    return;
  }

  session = joinSession(config.deck, {
    current: () => (player.position ? refOf() : null),
    onState: (at) => {
      // go() reports the move synchronously, before the scene has loaded. Only that report is
      // the other window's: a click here while the scene still loads is this window's own.
      applyingRemote = true;
      try {
        void player.goHash(`#${at.scene}/${at.beat}`);
      } finally {
        applyingRemote = false;
      }
    },
    onEnd: () => {
      if (view === 'audience') window.close();
    },
  });

  window.addEventListener('hashchange', () => {
    const position = parseHash(player.outline, location.hash);
    if (position) player.go(position);
  });

  window.addEventListener('message', (event) => {
    const data = event.data as { type?: string; hash?: string } | null;
    if (data?.type === 'tobos:goto' && typeof data.hash === 'string')
      player.goHash(data.hash, false);
    if (data?.type === 'tobos:fullscreen') toggleFullscreen();
  });

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    else document.documentElement.requestFullscreen().catch(() => undefined);
  };

  window.addEventListener('keydown', (event) => {
    const what = action(event);
    if (!what) return;
    if (what === 'next' || what === 'prev') {
      event.preventDefault();
      player.step(what === 'next' ? 1 : -1);
    } else if (what === 'fullscreen') toggleFullscreen();
    else if (what === 'present' && view === 'deck') location.href = urlForView('presenter');
    else if (what === 'guides') document.documentElement.classList.toggle('tobos-guides');
  });
  if (view === 'audience') {
    // Esc ends the show. On release, so the same press doesn't also leave fullscreen elsewhere.
    (navigator as unknown as { keyboard?: { lock?: (keys: string[]) => Promise<void> } }).keyboard
      ?.lock?.(['Escape'])
      .catch(() => undefined);
    window.addEventListener('keyup', (event) => {
      if (event.key === 'Escape') {
        session?.end();
        window.close();
      }
    });
  }

  onTap(root, (delta) => player.step(delta));
  follow(
    config,
    () => [player],
    (rev) => {
      currentRev = rev;
      if (embedded)
        window.parent.postMessage({ type: 'tobos:position', hash: player.hash, rev }, '*');
    },
  );
}
