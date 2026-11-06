// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { onSwipe, onTap } from '../src/viewer/taps.ts';

let stage: HTMLElement;
let steps: number[];
let dispose: () => void;

beforeEach(() => {
  stage = document.createElement('div');
  stage.getBoundingClientRect = () => ({ left: 0, width: 300 }) as DOMRect;
  document.body.append(stage);
  steps = [];
});
afterEach(() => {
  dispose();
  stage.remove();
});

/** jsdom has no Touch: a touch event whose touches are plain points. */
function touch(
  type: 'touchstart' | 'touchend',
  point: { x: number; y: number },
  rest = 0,
  target: Element = stage,
) {
  const event = new TouchEvent(type, { bubbles: true });
  const at = { clientX: point.x, clientY: point.y };
  const down = type === 'touchstart' ? [at, ...Array(rest).fill(at)] : Array(rest).fill(at);
  Object.defineProperty(event, 'touches', { value: down });
  Object.defineProperty(event, 'changedTouches', { value: [at] });
  target.dispatchEvent(event);
}

function swipe(from: { x: number; y: number }, to: { x: number; y: number }) {
  touch('touchstart', from);
  touch('touchend', to);
}

describe('onSwipe', () => {
  beforeEach(() => (dispose = onSwipe(stage, (delta) => steps.push(delta))));

  it('steps forward on a swipe to the left, back on one to the right', () => {
    swipe({ x: 200, y: 100 }, { x: 100, y: 110 });
    swipe({ x: 100, y: 100 }, { x: 200, y: 90 });
    expect(steps).toEqual([1, -1]);
  });

  it('leaves a short move, a scroll, a diagonal and two fingers alone', () => {
    swipe({ x: 200, y: 100 }, { x: 180, y: 100 });
    swipe({ x: 150, y: 200 }, { x: 160, y: 100 });
    swipe({ x: 200, y: 100 }, { x: 140, y: 170 });
    touch('touchstart', { x: 200, y: 100 });
    touch('touchstart', { x: 200, y: 100 }, 1);
    touch('touchend', { x: 100, y: 100 }, 1);
    touch('touchend', { x: 100, y: 100 });
    expect(steps).toEqual([]);
  });

  it("leaves a swipe that starts on the scene's own controls to them", () => {
    const button = document.createElement('button');
    stage.append(button);
    touch('touchstart', { x: 200, y: 100 }, 0, button);
    touch('touchend', { x: 100, y: 100 }, 0, button);
    expect(steps).toEqual([]);
  });
});

describe('onTap', () => {
  beforeEach(() => (dispose = onTap(stage, (delta) => steps.push(delta))));

  const pointer = (type: 'pointerdown' | 'pointerup', x: number, y = 100) =>
    stage.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y }));

  it('steps back in the left third, forward elsewhere', () => {
    pointer('pointerdown', 50);
    pointer('pointerup', 50);
    pointer('pointerdown', 250);
    pointer('pointerup', 250);
    expect(steps).toEqual([-1, 1]);
  });

  it('does not tap where the pointer moved, as a swipe the browser left a pointerup does', () => {
    pointer('pointerdown', 250);
    pointer('pointerup', 50);
    expect(steps).toEqual([]);
  });
});
