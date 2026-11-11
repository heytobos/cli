import { describe, expect, it } from 'vitest';
import {
  arrange,
  DEFAULT_LAYOUT,
  dragLeft,
  dragSlide,
  loadLayout,
  noteSize,
  NOTES_ROOM,
} from '../src/viewer/layout.ts';

const screen = { width: 1400, height: 800, label: 30, notes: true };

describe("the presenter's view's layout", () => {
  it('fits the slide to the height the notes leave, and the column to the slide', () => {
    const { left, pane, fullSlide, next } = arrange(DEFAULT_LAYOUT, screen);
    expect(pane).toBeCloseTo(fullSlide);
    expect(pane).toBeLessThanOrEqual(800 - NOTES_ROOM);
    expect(left / 1400).toBeGreaterThanOrEqual(0.45 - 0.01);
    // Next is half as wide as Now's slide.
    expect(next).toBeCloseTo(Math.min(left, ((pane - 30) * 16) / 9) / 2);
  });

  it('keeps the notes to less than half of a short screen', () => {
    const { pane } = arrange(DEFAULT_LAYOUT, { ...screen, height: 600 });
    expect(pane).toBeGreaterThanOrEqual(600 - 0.45 * 600 - 9);
  });

  it('gives the slide the column when there are no notes', () => {
    expect(arrange(DEFAULT_LAYOUT, { ...screen, notes: false }).pane).toBe(800);
  });

  it("keeps a dragged slide no taller than the column's width allows", () => {
    const wide = { ...DEFAULT_LAYOUT, left: 0.5, slide: 0.8 };
    const { pane, fullSlide } = arrange(wide, screen);
    expect(pane).toBe(Math.min(0.8 * 800 - 9, fullSlide));
    expect(arrange({ ...wide, slide: 0.4 }, screen).pane).toBe(0.4 * 800 - 9);
  });

  it('widens the column for a slide dragged taller, so the divider stays where it was put', () => {
    const fitted = arrange(DEFAULT_LAYOUT, screen);
    const taller = arrange({ ...DEFAULT_LAYOUT, slide: (fitted.pane + 9 + 60) / 800 }, screen);
    expect(taller.pane).toBeCloseTo(fitted.pane + 60);
    expect(taller.left).toBeGreaterThan(fitted.left);
    // The slide still fills the column's width: no ground beside it.
    expect(taller.fullSlide).toBeCloseTo(taller.pane);
    // Shorter, the column narrows with it, down to its least.
    const shorter = arrange({ ...DEFAULT_LAYOUT, slide: 0.35 }, screen);
    expect(shorter.pane).toBe(0.35 * 800 - 9);
    expect(shorter.left).toBeCloseTo(0.45 * 1400 - 9);
  });

  it("grows the slide into the notes' room for a column dragged wider, so no ground opens beside it", () => {
    const fitted = arrange(DEFAULT_LAYOUT, screen);
    const wider = arrange({ ...DEFAULT_LAYOUT, left: 0.6 }, screen);
    expect(wider.left).toBeGreaterThan(fitted.left);
    expect(wider.pane).toBeCloseTo(wider.fullSlide);
    // As far as a dragged slide goes, the notes keeping a fifth; the column stops with it.
    const widest = arrange({ ...DEFAULT_LAYOUT, left: 0.8 }, screen);
    expect(widest.pane).toBeCloseTo(0.8 * 800 - 9);
    expect(widest.left).toBeCloseTo(((0.8 * 800 - 9 - 30) * 16) / 9);
    expect(widest.fullSlide).toBeCloseTo(widest.pane);
  });

  it('keeps a divider within its range', () => {
    expect(dragSlide(700, 800)).toBe(0.8);
    expect(dragSlide(300, 800)).toBe(0.375);
    expect(dragSlide(10, 800)).toBe(0.3);
    expect(dragLeft(2000, 1400)).toBe(0.8);
  });

  it('sizes the notes in steps, within their range', () => {
    expect(noteSize(24, 1)).toBe(28);
    expect(noteSize(16, -1)).toBe(16);
    expect(noteSize(40, 1)).toBe(40);
  });

  it('reads a saved layout, and the default for anything else', () => {
    const stored = (value: string | null) => ({ getItem: () => value });
    expect(loadLayout(stored('{"left":0.6,"slide":0.5,"notes":32}'))).toEqual({
      left: 0.6,
      slide: 0.5,
      notes: 32,
    });
    expect(loadLayout(stored('{"left":7,"notes":23}'))).toEqual(DEFAULT_LAYOUT);
    expect(loadLayout(stored('not json'))).toEqual(DEFAULT_LAYOUT);
    expect(loadLayout(undefined)).toEqual(DEFAULT_LAYOUT);
  });
});
