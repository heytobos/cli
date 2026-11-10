/**
 * The presenter's timer: it runs from the first Present, holds while paused, and goes back to
 * 0:00 on reset. A value the view keeps in its state; each change makes a new one.
 */
export interface Timer {
  readonly paused: boolean;
  /** Milliseconds run before `since`. */
  readonly base: number;
  /** When it last set off, while it runs. */
  readonly since: number | null;
  readonly started: boolean;
}

export const NEW_TIMER: Timer = { paused: false, base: 0, since: null, started: false };

/** Whole seconds run by `now`. */
export function seconds(timer: Timer, now: number): number {
  const run = timer.since === null ? 0 : now - timer.since;
  return Math.max(0, Math.floor((timer.base + run) / 1000));
}

/** The first Present, or an audience window that opened: once; paused before, it waits. */
export function started(timer: Timer, now: number): Timer {
  if (timer.started) return timer;
  return { ...timer, started: true, since: timer.paused ? null : now };
}

export function toggled(timer: Timer, now: number): Timer {
  if (timer.paused) return { ...timer, paused: false, since: timer.started ? now : null };
  const base = timer.since === null ? timer.base : timer.base + now - timer.since;
  return { ...timer, paused: true, base, since: null };
}

export function reset(timer: Timer, now: number): Timer {
  return { ...timer, base: 0, since: timer.since === null ? null : now };
}

/** A duration as the timer shows it: 4:05, or 1:02:05 past an hour. */
export function duration(seconds: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return seconds >= 3600
    ? `${Math.floor(seconds / 3600)}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`
    : `${Math.floor(seconds / 60)}:${pad(seconds % 60)}`;
}
