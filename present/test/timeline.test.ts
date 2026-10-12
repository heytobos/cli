// @vitest-environment jsdom
import { gsap } from 'gsap';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Beat } from '../src/index.ts';
import { SceneTimeline } from '../src/timeline.ts';

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
    // The engine's central invariant (from the course engine, TUW-20).
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
