import { describe, expect, it } from 'vitest';
import { versionName } from '../src/version-name.ts';

describe('a theme version’s name (ADR 0010, D6)', () => {
  const now = new Date('2026-11-30T12:00:00Z');
  const vienna = 'Europe/Vienna';

  it('is its day, in the viewer’s time zone', () => {
    const at = '2026-11-28T15:40:00Z';
    expect(versionName(at, [at], vienna, now)).toBe('28 November');
    // Late on the 28th in Vienna is already the 29th in Tokyo.
    expect(versionName('2026-11-28T22:30:00Z', [], 'Asia/Tokyo', now)).toBe('29 November');
  });

  it('adds its time where the theme published another that day, wherever it is named', () => {
    const morning = '2026-11-28T09:15:00Z';
    const afternoon = '2026-11-28T15:40:00Z';
    const all = [morning, afternoon, '2026-11-14T10:00:00Z'];
    expect(versionName(morning, all, vienna, now)).toBe('28 November, 10:15');
    expect(versionName(afternoon, all, vienna, now)).toBe('28 November, 16:40');
    expect(versionName('2026-11-14T10:00:00Z', all, vienna, now)).toBe('14 November');
    // The same two, a day apart where the viewer is: no time needed.
    const late = '2026-11-28T23:30:00Z';
    expect(versionName(late, [afternoon, late], vienna, now)).toBe('29 November');
  });

  it('adds its seconds where the theme published another that same minute', () => {
    const first = '2026-11-28T15:40:05Z';
    const second = '2026-11-28T15:40:50Z';
    const all = [first, second, '2026-11-28T09:15:00Z'];
    expect(versionName(first, all, vienna, now)).toBe('28 November, 16:40:05');
    expect(versionName(second, all, vienna, now)).toBe('28 November, 16:40:50');
    expect(versionName('2026-11-28T09:15:00Z', all, vienna, now)).toBe('28 November, 10:15');
    // Within one second: its thousandths too.
    const close = ['2026-11-28T15:40:05.100Z', '2026-11-28T15:40:05.900Z'];
    expect(close.map((at) => versionName(at, close, vienna, now))).toEqual([
      '28 November, 16:40:05.100',
      '28 November, 16:40:05.900',
    ]);
  });

  it('shows the year when it isn’t the current one', () => {
    expect(versionName('2025-12-02T10:00:00Z', [], vienna, now)).toBe('2 December 2025');
    expect(
      versionName(
        '2025-12-02T10:00:00Z',
        ['2025-12-02T10:00:00Z', '2025-12-02T11:00:00Z'],
        vienna,
        now,
      ),
    ).toBe('2 December 2025, 11:00');
  });
});
