// @vitest-environment jsdom
import { gsap } from 'gsap';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Beat } from '../src/index.ts';
import { addSpan, SceneTimeline } from '../src/timeline.ts';

let root: HTMLElement;

const markup = '<p class="a">a</p><p class="b">b</p><p class="c">c</p>';

beforeEach(() => {
  root = document.createElement('div');
  root.innerHTML = markup;
  document.body.append(root);
});
afterEach(() => root.remove());

const beats: Beat[] = [
  { id: 'a', enter: (tl, q) => tl.from(q('.a'), { opacity: 0, duration: 0.5 }) },
  { id: 'still' },
  { id: 'b', enter: (tl, q) => tl.from(q('.b'), { opacity: 0, duration: 0.5 }) },
  { id: 'c', enter: (tl, q) => tl.from(q('.c'), { opacity: 0, duration: 0.5 }) },
];

const opacity = (cls: string, within = root) =>
  Number(gsap.getProperty(within.querySelector(cls)!, 'opacity'));
const snapshot = (within = root) => ['.a', '.b', '.c'].map((cls) => opacity(cls, within));

describe('a scene timeline', () => {
  it('starts before the first beat, everything hidden that a beat reveals', () => {
    new SceneTimeline(root, beats);
    expect(snapshot()).toEqual([0, 0, 0]);
  });

  it('lands on end states instantly', () => {
    const tl = new SceneTimeline(root, beats);
    tl.show(2, false);
    expect(snapshot()).toEqual([1, 1, 0]);
    tl.show(0, false);
    expect(snapshot()).toEqual([1, 0, 0]);
  });

  it('plays a step forward from the previous end state', () => {
    const tl = new SceneTimeline(root, beats);
    tl.show(1, false);
    tl.show(2, true);
    expect(tl.playing).toBe(true);
    expect(opacity('.b')).toBeLessThan(1);
    tl.finish();
    expect(snapshot()).toEqual([1, 1, 0]);
  });

  it('finishes a playing beat when the next one starts', () => {
    const tl = new SceneTimeline(root, beats);
    tl.show(2, true);
    tl.show(3, true);
    expect(opacity('.b')).toBe(1);
    tl.finish();
    expect(snapshot()).toEqual([1, 1, 1]);
  });

  it('samples part-way through a beat', () => {
    const tl = new SceneTimeline(root, beats);
    tl.sample(2, 0.5);
    expect(opacity('.a')).toBe(1);
    expect(opacity('.b')).toBeGreaterThan(0);
    expect(opacity('.b')).toBeLessThan(1);
    expect(tl.duration(1)).toBe(0);
    expect(tl.duration(2)).toBe(0.5);
  });

  it('after any sequence of moves, equals a fresh load at that beat', () => {
    // The engine's central invariant, from the course engine it grew out of.
    let seed = 7;
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const tl = new SceneTimeline(root, beats);
    let at = 0;
    for (let i = 0; i < 200; i++) {
      const forward = random() < 0.6;
      const target = forward ? Math.min(at + 1, 3) : Math.floor(random() * 4);
      tl.show(target, forward && target === at + 1);
      at = target;
      if (random() < 0.3) tl.finish();
      tl.finish();
      const fresh = document.createElement('div');
      fresh.innerHTML = markup;
      document.body.append(fresh);
      const other = new SceneTimeline(fresh, beats);
      other.show(at, false);
      expect(snapshot()).toEqual(snapshot(fresh));
      other.kill();
      fresh.remove();
    }
  });
});

describe("a beat's loop", () => {
  /** Move GSAP's clock on, as its ticker would. */
  const elapse = (seconds: number) => gsap.updateRoot(gsap.globalTimeline.rawTime() + seconds);
  const x = () => Number(gsap.getProperty(root.querySelector('.c')!, 'x'));
  const spin = (until?: string): Beat[] => [
    { id: 'a' },
    {
      id: 'spin',
      enter: (tl, q) => tl.from(q('.b'), { opacity: 0, duration: 0.5 }),
      loop: (tl, q) => tl.to(q('.c'), { x: 100, duration: 4, ease: 'none' }),
      ...(until === undefined ? {} : { until }),
    },
    { id: 'c' },
    { id: 'd' },
  ];

  it('repeats through its range, from its start on each arrival, whichever way', () => {
    const tl = new SceneTimeline(root, spin('d'));
    tl.loops(true);
    tl.show(0, false);
    elapse(1);
    expect(x()).toBe(0);
    tl.show(1, true);
    elapse(1);
    expect(x()).toBeCloseTo(25);
    elapse(4);
    expect(x()).toBeCloseTo(25);
    // On through the next beat, without starting again.
    tl.show(2, true);
    elapse(1);
    expect(x()).toBeCloseTo(50);
    // The beat it stops at puts it back at its start.
    tl.show(3, true);
    expect(x()).toBe(0);
    elapse(1);
    expect(x()).toBe(0);
    // A jump back into the range plays it from its start.
    tl.show(2, false);
    elapse(1);
    expect(x()).toBeCloseTo(25);
    tl.kill();
  });

  it("repeats to the scene's end by default, and stops when the scene leaves or waits", () => {
    const tl = new SceneTimeline(root, spin());
    tl.loops(true);
    tl.show(3, false);
    elapse(1);
    expect(x()).toBeCloseTo(25);
    tl.leave();
    expect(x()).toBe(0);
    tl.show(1, false);
    elapse(2);
    expect(x()).toBeCloseTo(50);
    tl.hold();
    expect(x()).toBe(0);
    tl.kill();
  });

  it('stays at its start until a stage plays it, and starts once animations are on', () => {
    // A page of the PDF is a timeline no stage plays.
    const tl = new SceneTimeline(root, spin());
    tl.show(1, false);
    elapse(1);
    expect(x()).toBe(0);
    tl.loops(true);
    elapse(1);
    expect(x()).toBeCloseTo(25);
    tl.loops(false);
    expect(x()).toBe(0);
    tl.kill();
  });

  it('starts and stops alone: a sound playing on through beats is left as it was', () => {
    const span = { start: vi.fn(), stop: vi.fn(() => Promise.resolve()) };
    const tl = new SceneTimeline(root, [
      { id: 'a', enter: (timeline) => addSpan(timeline, 'c', span) },
      ...spin().slice(1),
    ]);
    tl.loops(true);
    tl.show(0, true);
    tl.show(1, true);
    expect(span.start).toHaveBeenCalledOnce();
    // Past its range, where a sound of a later beat may be playing on the same element.
    tl.show(2, true);
    expect(span.stop).toHaveBeenCalled();
    span.stop.mockClear();
    tl.loops(false);
    tl.loops(true);
    expect(span.stop).not.toHaveBeenCalled();
    tl.kill();
  });

  it("leaves the beats' timing as it was", () => {
    const tl = new SceneTimeline(root, spin());
    expect(tl.duration(1)).toBe(0.5);
    expect(tl.timeline.duration()).toBe(0.5);
    tl.kill();
  });

  it('warns of an until that names no later beat, or a loop that takes no time', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const tl = new SceneTimeline(root, [...spin('a'), { id: 'empty', loop: () => undefined }]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('until names "a"'));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('its loop animates nothing'));
    tl.show(1, false);
    elapse(1);
    expect(x()).toBe(0);
    tl.kill();
    warn.mockRestore();
  });
});
