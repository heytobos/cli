/**
 * The window's one stream from the server (`config.events`): every link's pushes, and on a
 * presenter's link the room's `results` and the speaker's `notes` too. Live follow, the projector's
 * results and the presenter's notes each listen for their own type; the stream opens with the
 * first listener and closes with the last.
 */
import { stream } from './stream.ts';

type Listener = (data: string) => void;

const TYPES = ['push', 'results', 'notes'] as const;
export type EventType = (typeof TYPES)[number];

const listeners = new Map<EventType, Set<Listener>>(TYPES.map((type) => [type, new Set()]));
/** Told each time the stream opens again after a gap, when what was sent meanwhile is missed. */
const reopened = new Set<() => void>();
let stop: (() => void) | undefined;

/** Listen for one type of event on `url`, the window's stream: until the returned function runs. */
export function listen(
  url: string,
  type: EventType,
  listener: Listener,
  onReopen?: () => void,
): () => void {
  listeners.get(type)!.add(listener);
  if (onReopen) reopened.add(onReopen);
  stop ??= stream(
    url,
    Object.fromEntries(
      TYPES.map((t) => [t, (data: string) => listeners.get(t)!.forEach((l) => l(data))]),
    ),
    (again) => again && reopened.forEach((f) => f()),
  );
  return () => {
    listeners.get(type)!.delete(listener);
    if (onReopen) reopened.delete(onReopen);
    if ([...listeners.values()].every((set) => set.size === 0)) {
      stop?.();
      stop = undefined;
    }
  };
}
