import { letterbox } from '../letterbox.ts';
import { onSoundRefused } from '../playback.ts';
import { formatHash, parseHash, same, START } from '../position.ts';
import { showHash, type View, type ViewerConfig } from './config.ts';
import {
  action,
  actionIn,
  actionMessage,
  ARRANGING,
  moveOf,
  ownerOf,
  PRESSED,
  type Action,
} from './keys.ts';
import { follow } from './live.ts';
import { Player } from './player.ts';
import { settled } from './ready.ts';
import { introduceAudience } from './screens.ts';
import { joinWindows, type BeatRef } from './windows.ts';
import { shareBar } from './share-bar.ts';
import { onSwipe, onTap } from './taps.ts';

/**
 * The deck on one stage: the plain view, the audience window, and the view render uses. A share
 * link's page is the plain view on its own: it shares no beat with other windows and presents
 * nothing, but still goes fullscreen.
 */
export function showDeck(root: HTMLElement, config: ViewerConfig, view: View) {
  const { stage } = letterbox(root);
  const render = view === 'render';
  if (view === 'audience' || render) document.documentElement.classList.add('tobos-no-cursor');

  let sync: ReturnType<typeof joinWindows> | null = null;
  let currentRev = config.rev;
  const embedded = window.parent !== window;
  // On someone else's page (a deck's preview on the app's) the stage has no black bars:
  // the box around it is 16:9 already, and the sub-pixel it misses by would show as a black line.
  if (embedded) document.documentElement.classList.add('tobos-embedded');
  const player: Player = new Player(stage, config.manifest, {
    presenting: view === 'audience',
    mountAhead: !render,
    // A render lands on end states anyway; as a still view, it keeps loops at their start too.
    still: render,
    onMove: (position) => {
      const hash = formatHash(player.outline, position);
      showHash(hash);
      if (!applyingRemote) sync?.publish(refOf());
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

  // The audience opens on the deck page's beat, maybe a hidden scene's: presenting begins at the
  // next that shows. Reloaded mid-way, it hears the presenter's beat, hidden or not (windows.ts).
  const ready = player.go(player.startOf(location.hash));

  if (render) {
    // The API `tobos render` drives through a headless browser. goto and sample say whether the
    // frame was fully drawn in time (settled): a render taken anyway says so.
    (window as unknown as { __tobos: unknown }).__tobos = {
      ready: ready.then(async () => void (await settled(stage))),
      outline: () => player.outline,
      async goto(hash: string) {
        await player.goHash(hash, false);
        return settled(stage);
      },
      async sample(hash: string, progress: number) {
        const position = parseHash(player.outline, hash) ?? START;
        // Frames of one beat in a row: move only for the first, so a video seeks once a frame.
        if (!same(player.position, position)) await player.go(position, false);
        player.stage.shown?.timeline.sample(position.beat, progress);
        return settled(stage);
      },
      duration(hash: string) {
        const position = parseHash(player.outline, hash) ?? START;
        return player.stage.shown?.timeline.duration(position.beat) ?? 0;
      },
    };
    return;
  }

  const shared = Boolean(config.shared);
  if (!shared)
    sync = joinWindows(config.deck, view, {
      current: () => (player.position ? refOf() : null),
      onState: (at, start) => {
        // go() reports the move synchronously, before the scene has loaded. Only that report is
        // the other window's: a click here while the scene still loads is this window's own.
        // Of the windows that follow, only the audience is heard: the room has one sound.
        applyingRemote = true;
        try {
          const hash = `#${at.scene}/${at.beat}`;
          const to = start ? player.startOf(hash) : player.positionOf(hash);
          void player.go(to, undefined, view === 'audience');
        } finally {
          applyingRemote = false;
        }
      },
      onEnd: () => {
        if (view === 'audience') window.close();
      },
      onPresenter: view === 'audience' ? introduceAudience : undefined,
    });
  if (view === 'audience') introduceAudience();

  window.addEventListener('hashchange', () => {
    const position = parseHash(player.outline, location.hash);
    if (position) player.go(position);
  });

  // An iPhone has no fullscreen for a page, nor the deck's page's preview (its frame allows none):
  // there, F does nothing. Refused in the projector, as F in the presenter's view is outside
  // Chromium, the presenter's view hears so (windows.ts).
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    else
      document.documentElement.requestFullscreen?.().catch(() => {
        if (view === 'audience') sync?.refused();
      });
  };

  /** One of the slides' actions (keys.ts), from a key pressed here or handed on by its owner. */
  const run = (what: Action) => {
    const move = moveOf(what);
    if (move?.by === 'beat') player.step(move.delta);
    else if (move) player.stepScene(move.delta);
    else if (what === 'fullscreen') toggleFullscreen();
    else if (what === 'guides') document.documentElement.classList.toggle('tobos-guides');
  };

  /** Whether the deck's page around it arranges its scenes now, so it takes their keys. */
  let arranging = false;
  window.addEventListener('message', (event) => {
    const data = event.data as { type?: string; hash?: string; on?: unknown } | null;
    if (data?.type === 'tobos:goto' && typeof data.hash === 'string')
      player.goHash(data.hash, false);
    // A key pressed on the deck's page around this preview, or F in the presenter's view for the
    // projector: the action, if it is the slides'.
    const what = actionIn(data);
    if (what && ownerOf(what) === 'slides') run(what);
    // The deck's page can turn the preview's animations off, to click through the end states.
    if (data?.type === 'tobos:animate') player.stage.animate(Boolean(data.on));
    // And say whether its keys arrange the scenes now.
    if (data?.type === 'tobos:arranging') arranging = Boolean(data.on);
  });

  window.addEventListener('keydown', (event) => {
    const what = action(event);
    if (!what) return;
    if (moveOf(what)) event.preventDefault();
    if (ownerOf(what) === 'slides') return run(what);
    // Presenting and arranging are the deck page's (TOB-404, D1): in its preview, the key press is
    // the page's too, so it may open the projector. A viewer on its own presents nothing. Enter on
    // a slide's own button presses it.
    if (!(view === 'deck' && embedded && !shared)) return;
    // Arranging's keys only while the page arranges (its Scenes tab, for its editors), so they
    // stay the slides' otherwise; and Enter on a slide's own control presses it.
    if (ARRANGING.has(what) && !arranging) return;
    if (what === 'rename' && (event.target as Element | null)?.closest?.(PRESSED)) return;
    event.preventDefault();
    window.parent.postMessage(actionMessage(what), '*');
  });
  if (view === 'audience') {
    // Esc stops presenting. On release, so the same press doesn't also leave fullscreen elsewhere.
    (navigator as unknown as { keyboard?: { lock?: (keys: string[]) => Promise<void> } }).keyboard
      ?.lock?.(['Escape'])
      .catch(() => undefined);
    window.addEventListener('keyup', (event) => {
      if (event.key === 'Escape') {
        sync?.end();
        window.close();
      }
    });
  }

  if (view === 'audience') {
    // Opened by a key press elsewhere, the audience can't go fullscreen by itself: its first
    // click does that, rather than step. Shown again once out of fullscreen: outside Chromium, or
    // without the lock above, the browser takes Esc to leave fullscreen, and only the next one
    // reaches the page.
    const hint = document.createElement('div');
    hint.className = 'tobos-fullscreen-hint';
    hint.textContent = 'Click or press F for fullscreen · Esc to end';
    root.append(hint);
  }
  // A browser lets a window make sound once it has had a click or key press. Until then, a
  // sound it refuses waits for one (playback.ts), and this says so.
  const soundHint = document.createElement('div');
  soundHint.className = 'tobos-sound-hint';
  soundHint.textContent = 'Click for sound';
  soundHint.hidden = true;
  root.append(soundHint);
  onSoundRefused(() => (soundHint.hidden = false));
  for (const type of ['pointerup', 'keydown'] as const)
    window.addEventListener(type, () => (soundHint.hidden = true));
  onTap(root, (delta) => {
    if (view === 'audience' && !document.fullscreenElement && document.fullscreenEnabled)
      toggleFullscreen();
    else player.step(delta);
  });
  // A swipe only steps: the browser may not count the end of a moving finger as the tap that
  // fullscreen, or sound, wants.
  onSwipe(root, (delta) => player.step(delta));
  if (config.shared)
    shareBar(root, config.shared, (on) => player.stage.animate(on), toggleFullscreen);
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
