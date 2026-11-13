import { describe, expect, it } from 'vitest';
import {
  action,
  actionIn,
  moveOf,
  ownerOf,
  presenterKey,
  type Action,
} from '../src/viewer/keys.ts';

/** A key press as action() reads it, on the page's body unless told where. */
const press = (key: string, more: Partial<KeyboardEvent> = {}) =>
  ({ key, target: null, metaKey: false, ctrlKey: false, altKey: false, ...more }) as KeyboardEvent;

describe('the one key map', () => {
  it('reads each key the same, wherever it lands', () => {
    // ← → and a clicker's keys step a beat, ↓ ↑ a scene.
    expect(['ArrowRight', 'PageDown', ' '].map((k) => action(press(k)))).toEqual(
      Array(3).fill('next'),
    );
    expect(['ArrowLeft', 'PageUp'].map((k) => action(press(k)))).toEqual(Array(2).fill('prev'));
    expect([action(press('ArrowDown')), action(press('ArrowUp'))]).toEqual([
      'next-scene',
      'prev-scene',
    ]);
    expect([action(press('f')), action(press('L')), action(press('Escape'))]).toEqual([
      'fullscreen',
      'guides',
      'end',
    ]);
    expect([action(press('h')), action(press('H'))]).toEqual(['hide', 'hide']);
    // Arranging the deck's scenes, as its page does them.
    const command = { metaKey: true };
    expect(
      [
        press('z', command),
        press('Z', { ...command, shiftKey: true }),
        press('ArrowUp', command),
        press('ArrowDown', command),
        press('ArrowUp', { ...command, shiftKey: true }),
        press('ArrowDown', { ctrlKey: true, shiftKey: true }),
        press('Backspace', command),
        press('Delete'),
        press('Enter'),
        press('F2'),
        press('F10', { shiftKey: true }),
        press('ContextMenu'),
        press('r'),
        press('R', { shiftKey: true }),
      ].map(action),
    ).toEqual([
      'undo',
      'redo',
      'up',
      'down',
      'first',
      'last',
      'remove',
      'remove',
      'rename',
      'rename',
      'menu',
      'menu',
      'retitle',
      'retitle',
    ]);
    expect(action(press('ArrowDown', { shiftKey: true }))).toBe('next-scene');
    expect(action(press('Enter', { metaKey: true }))).toBe('present');
    expect(action(press('Enter', { ctrlKey: true }))).toBe('present');
    // Other keys with a modifier are the browser's.
    expect(action(press('f', { metaKey: true }))).toBeNull();
  });

  it("leaves a field's keys to the field", () => {
    const field = { closest: (selector: string) => (selector.includes('textarea') ? {} : null) };
    expect(action(press('ArrowRight', { target: field as unknown as EventTarget }))).toBeNull();
  });

  it('gives presenting and arranging to the page, and everything else to the slides', () => {
    expect(ownerOf('present')).toBe('page');
    for (const what of [
      'hide',
      'undo',
      'redo',
      'up',
      'down',
      'first',
      'last',
      'remove',
      'rename',
      'menu',
      'retitle',
    ] as Action[])
      expect(ownerOf(what), what).toBe('page');
    for (const what of [
      'next',
      'prev',
      'next-scene',
      'prev-scene',
      'fullscreen',
      'guides',
      'end',
    ] as Action[])
      expect(ownerOf(what), what).toBe('slides');
  });

  it('moves the stage by a beat or a scene, either way, and does nothing else', () => {
    expect(
      (['next', 'prev', 'next-scene', 'prev-scene'] as Action[]).map((what) => moveOf(what)),
    ).toEqual([
      { by: 'beat', delta: 1 },
      { by: 'beat', delta: -1 },
      { by: 'scene', delta: 1 },
      { by: 'scene', delta: -1 },
    ]);
    for (const what of ['fullscreen', 'end', 'present', 'up', 'down'] as Action[])
      expect(moveOf(what), what).toBeNull();
  });

  it('reads an action from its one message, and nothing else', () => {
    expect(actionIn({ type: 'tobos:action', action: 'next' })).toBe('next');
    expect(actionIn({ type: 'tobos:action', action: 'prev-scene' })).toBe('prev-scene');
    expect(actionIn({ type: 'tobos:action', action: 'present' })).toBe('present');
    expect(actionIn({ type: 'tobos:action', action: 'hide' })).toBe('hide');
    for (const data of [
      { type: 'tobos:action', action: 'jump' },
      { type: 'tobos:step', delta: 1 },
      { type: 'tobos:present' },
      null,
      'next',
    ])
      expect(actionIn(data), JSON.stringify(data)).toBeNull();
  });
});

describe("the presenter's view's own keys", () => {
  it('pauses the timer, sizes and scrolls the notes, and goes back after a jump', () => {
    expect(['p', 'P', '+', '=', '-', 'Backspace'].map((k) => presenterKey(press(k)))).toEqual([
      'pause',
      'pause',
      'larger',
      'larger',
      'smaller',
      'back',
    ]);
    expect([
      presenterKey(press('ArrowDown', { shiftKey: true })),
      presenterKey(press('ArrowUp', { shiftKey: true })),
    ]).toEqual(['notes-down', 'notes-up']);
  });

  it("leaves the stage's keys, a modifier's and a field's alone", () => {
    expect(
      ['ArrowDown', 'ArrowRight', ' ', 'f', 'Escape'].map((k) => presenterKey(press(k))),
    ).toEqual(Array(5).fill(null));
    expect(presenterKey(press('Backspace', { metaKey: true }))).toBeNull();
    const field = { closest: (selector: string) => (selector.includes('input') ? {} : null) };
    expect(presenterKey(press('p', { target: field as unknown as EventTarget }))).toBeNull();
  });
});
