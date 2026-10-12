/**
 * Windows showing the same deck (presenter and audience) stay on the same beat.
 * Either can drive; a window that opens or reloads mid-talk adopts the current beat.
 */
export interface BeatRef {
  scene: string;
  beat: string;
}

type Message =
  | { kind: 'hello'; from: string }
  | { kind: 'state'; from: string; at: BeatRef; time: number }
  | { kind: 'end'; from: string };

export interface Session {
  publish(at: BeatRef): void;
  end(): void;
  close(): void;
}

export function joinSession(
  deck: string,
  handlers: { onState: (at: BeatRef) => void; onEnd?: () => void; current: () => BeatRef | null },
): Session {
  if (!('BroadcastChannel' in window)) return { publish() {}, end() {}, close() {} };
  const me = Math.random().toString(36).slice(2);
  const channel = new BroadcastChannel(`tobos:${deck}`);
  let lastTime = 0;
  channel.onmessage = (event: MessageEvent<Message>) => {
    const message = event.data;
    if (!message || message.from === me) return;
    if (message.kind === 'hello') {
      const at = handlers.current();
      if (at)
        channel.postMessage({ kind: 'state', from: me, at, time: lastTime } satisfies Message);
    } else if (message.kind === 'state') {
      if (message.time < lastTime) return;
      lastTime = message.time;
      handlers.onState(message.at);
    } else if (message.kind === 'end') handlers.onEnd?.();
  };
  const hello = () => channel.postMessage({ kind: 'hello', from: me } satisfies Message);
  hello();
  window.addEventListener('pageshow', hello);
  return {
    publish(at) {
      lastTime = Date.now();
      channel.postMessage({ kind: 'state', from: me, at, time: lastTime } satisfies Message);
    },
    end() {
      channel.postMessage({ kind: 'end', from: me } satisfies Message);
    },
    close() {
      window.removeEventListener('pageshow', hello);
      channel.close();
    },
  };
}
