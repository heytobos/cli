import { describe, expect, it } from 'vitest';
import { action, actionIn, ownerOf, type Action } from '../src/viewer/keys.ts';

/** A key press as action() reads it, on the page's body unless told where. */
const press = (key: string, more: Partial<KeyboardEvent> = {}) =>
  ({ key, target: null, metaKey: false, ctrlKey: false, altKey: false, ...more }) as KeyboardEvent;

describe('the one key map', () => {
  it('reads each key the same, wherever it lands', () => {
    expect(['ArrowRight', 'ArrowDown', 'PageDown', ' '].map((k) => action(press(k)))).toEqual(
      Array(4).fill('next'),
    );
    expect(['ArrowLeft', 'ArrowUp', 'PageUp'].map((k) => action(press(k)))).toEqual(
      Array(3).fill('prev'),
    );
    expect([action(press('f')), action(press('L')), action(press('Escape'))]).toEqual([
      'fullscreen',
      'guides',
      'end',
    ]);
    expect([action(press('h')), action(press('H'))]).toEqual(['hide', 'hide']);
    expect(action(press('Enter', { metaKey: true }))).toBe('present');
    expect(action(press('Enter', { ctrlKey: true }))).toBe('present');
    // Other keys with a modifier are the browser's.
    expect(action(press('f', { metaKey: true }))).toBeNull();
  });

  it("leaves a field's keys to the field", () => {
    const field = { closest: (selector: string) => (selector.includes('textarea') ? {} : null) };
    expect(action(press('ArrowRight', { target: field as unknown as EventTarget }))).toBeNull();
  });

  it('gives presenting and hiding to the page, and everything else to the slides', () => {
    expect(ownerOf('present')).toBe('page');
    expect(ownerOf('hide')).toBe('page');
    for (const what of ['next', 'prev', 'fullscreen', 'guides', 'end'] as Action[])
      expect(ownerOf(what), what).toBe('slides');
  });

  it('reads an action from its one message, and nothing else', () => {
    expect(actionIn({ type: 'tobos:action', action: 'next' })).toBe('next');
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
