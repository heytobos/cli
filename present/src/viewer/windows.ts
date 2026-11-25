import type { View } from './config.ts';

/**
 * Windows showing the same deck (presenter and audience) stay on the same beat.
 * Either can drive; a window that opens or reloads mid-talk adopts the current beat.
 * Every message names its window's view, so a presenter opened after the audience knows the deck
 * is being presented. The audience plays the animations as the presenter's view says, which a
 * window that opens hears with the beat.
 */
export interface BeatRef {
  scene: string;
  beat: string;
}

type Message = { from: string; view: View } & (
  | { kind: 'hello' }
  /** The answer to a hello from a window that has no beat yet. */
  | { kind: 'here' }
  /** `answer`: to a hello, the beat a window that opens takes up. */
  | { kind: 'state'; at: BeatRef; time: number; answer?: true }
  | { kind: 'end' }
  /** The audience refused fullscreen to a key press elsewhere: it needs a click of its own. */
  | { kind: 'refused' }
  /** The presenter's switch: whether the audience plays the animations. */
  | { kind: 'animate'; on: boolean }
  | { kind: 'bye' }
);

export interface WindowSync {
  publish(at: BeatRef): void;
  end(): void;
  /** Fullscreen, asked for from another window, was refused here. */
  refused(): void;
  /** The presenter's view: whether the audience plays the animations. */
  animate(on: boolean): void;
  close(): void;
}

export function joinWindows(
  deck: string,
  view: View,
  handlers: {
    /**
     * Another window's beat. `start`: the deck's page's, to a window that opens, which presenting
     * begins from; a hidden scene's beat is then the next scene that shows (Player.startOf).
     */
    onState: (at: BeatRef, start: boolean) => void;
    onEnd?: () => void;
    /** Whether an audience window is open, as it changes. */
    onAudience?: (open: boolean) => void;
    /** The audience refused fullscreen to a key press in this window. */
    onRefused?: () => void;
    /** A presenter's view opened, or reloaded. */
    onPresenter?: () => void;
    /** The presenter's view turned the audience's animations on or off. */
    onAnimate?: (on: boolean) => void;
    /** The presenter's view: its switch, which a window that opens hears with the beat. */
    animating?: () => boolean;
    current: () => BeatRef | null;
  },
): WindowSync {
  if (!('BroadcastChannel' in window))
    return { publish() {}, end() {}, refused() {}, animate() {}, close() {} };
  const me = Math.random().toString(36).slice(2);
  const channel = new BroadcastChannel(`tobos:${deck}`);
  let lastTime = 0;
  const audiences = new Set<string>();
  const send = (message: Message) => channel.postMessage(message);
  channel.onmessage = (event: MessageEvent<Message>) => {
    const message = event.data;
    if (!message || message.from === me) return;
    if (message.view === 'audience') {
      const had = audiences.size > 0;
      if (message.kind === 'bye') audiences.delete(message.from);
      else audiences.add(message.from);
      if (had !== audiences.size > 0) handlers.onAudience?.(audiences.size > 0);
    }
    if (message.kind === 'hello') {
      if (message.view === 'presenter') handlers.onPresenter?.();
      // The animations before the beat, so the window that opens moves to it as they say.
      const on = handlers.animating?.();
      if (on !== undefined) send({ kind: 'animate', from: me, view, on });
      const at = handlers.current();
      if (at) send({ kind: 'state', from: me, view, at, time: lastTime, answer: true });
      else send({ kind: 'here', from: me, view });
    } else if (message.kind === 'state') {
      if (message.time < lastTime) return;
      lastTime = message.time;
      handlers.onState(message.at, message.view === 'deck' && message.answer === true);
    } else if (message.kind === 'end') handlers.onEnd?.();
    else if (message.kind === 'refused' && message.view === 'audience') handlers.onRefused?.();
    else if (message.kind === 'animate' && message.view === 'presenter')
      handlers.onAnimate?.(message.on);
  };
  const hello = () => send({ kind: 'hello', from: me, view });
  const bye = () => send({ kind: 'bye', from: me, view });
  hello();
  window.addEventListener('pageshow', hello);
  window.addEventListener('pagehide', bye);
  return {
    publish(at) {
      lastTime = Date.now();
      send({ kind: 'state', from: me, view, at, time: lastTime });
    },
    end() {
      send({ kind: 'end', from: me, view });
    },
    refused() {
      send({ kind: 'refused', from: me, view });
    },
    animate(on) {
      send({ kind: 'animate', from: me, view, on });
    },
    close() {
      bye();
      window.removeEventListener('pageshow', hello);
      window.removeEventListener('pagehide', bye);
      channel.close();
    },
  };
}
