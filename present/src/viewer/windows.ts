import type { View } from './config.ts';

/**
 * Windows showing the same deck (presenter and audience) stay on the same beat.
 * Either can drive; a window that opens or reloads mid-talk adopts the current beat.
 * Every message names its window's view, so a presenter opened after the audience knows the deck
 * is being presented.
 */
export interface BeatRef {
  scene: string;
  beat: string;
}

type Message = { from: string; view: View } & (
  | { kind: 'hello' }
  /** The answer to a hello from a window that has no beat yet. */
  | { kind: 'here' }
  | { kind: 'state'; at: BeatRef; time: number }
  | { kind: 'end' }
  /** The audience refused fullscreen to a key press elsewhere: it needs a click of its own. */
  | { kind: 'refused' }
  | { kind: 'bye' }
);

export interface WindowSync {
  publish(at: BeatRef): void;
  end(): void;
  /** Fullscreen, asked for from another window, was refused here. */
  refused(): void;
  close(): void;
}

export function joinWindows(
  deck: string,
  view: View,
  handlers: {
    onState: (at: BeatRef) => void;
    onEnd?: () => void;
    /** Whether an audience window is open, as it changes. */
    onAudience?: (open: boolean) => void;
    /** The audience refused fullscreen to a key press in this window. */
    onRefused?: () => void;
    current: () => BeatRef | null;
  },
): WindowSync {
  if (!('BroadcastChannel' in window)) return { publish() {}, end() {}, refused() {}, close() {} };
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
      const at = handlers.current();
      if (at) send({ kind: 'state', from: me, view, at, time: lastTime });
      else send({ kind: 'here', from: me, view });
    } else if (message.kind === 'state') {
      if (message.time < lastTime) return;
      lastTime = message.time;
      handlers.onState(message.at);
    } else if (message.kind === 'end') handlers.onEnd?.();
    else if (message.kind === 'refused' && message.view === 'audience') handlers.onRefused?.();
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
    close() {
      bye();
      window.removeEventListener('pageshow', hello);
      window.removeEventListener('pagehide', bye);
      channel.close();
    },
  };
}
