import { describe, expect, it } from 'vitest';
import { duration, NEW_TIMER, reset, seconds, started, toggled } from '../src/viewer/timer.ts';

describe("the presenter's timer", () => {
  it('runs from its start, holds while paused, and goes back to zero on reset', () => {
    let timer = NEW_TIMER;
    expect(seconds(timer, 5_000)).toBe(0);
    timer = started(timer, 10_000);
    expect(seconds(timer, 75_000)).toBe(65);
    timer = toggled(timer, 75_000);
    expect(seconds(timer, 500_000)).toBe(65);
    timer = toggled(timer, 500_000);
    expect(seconds(timer, 510_000)).toBe(75);
    timer = reset(timer, 510_000);
    expect(seconds(timer, 512_000)).toBe(2);
    // Only the first start counts.
    timer = started(timer, 600_000);
    expect(seconds(timer, 612_000)).toBe(102);
  });

  it('paused before it starts, waits for the presenter to go on', () => {
    let timer = started(toggled(NEW_TIMER, 0), 1_000);
    expect(seconds(timer, 9_000)).toBe(0);
    timer = toggled(timer, 9_000);
    expect(seconds(timer, 12_000)).toBe(3);
  });

  it('shows minutes, and hours past an hour', () => {
    expect([duration(0), duration(245), duration(3725)]).toEqual(['0:00', '4:05', '1:02:05']);
  });
});
