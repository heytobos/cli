import { describe, expect, it, vi } from 'vitest';
import { mediaGlob, mediaUrl, setMedia, setShared } from '../src/registry.ts';

describe('media', () => {
  it("names only the deck's own files, never what an object inherits", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setMedia(JSON.parse('{"cow.jpg": {"hash": "abc"}}'));
    expect(mediaUrl('cow.jpg')).toBe('media/abc');
    expect(mediaUrl('constructor')).toBe('');
    expect(mediaUrl('__proto__')).toBe('');
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it("says on a share that a file isn't there, not that media.json lacks it", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setMedia(JSON.parse('{"cow.jpg": {"hash": "abc"}}'));
    setShared(true);
    expect(mediaUrl('quiz/answer.png')).toBe('');
    expect(warn).toHaveBeenLastCalledWith("[tobos] media/quiz/answer.png isn't available here");
    setShared(false);
    expect(mediaUrl('quiz/answer.png')).toBe('');
    expect(warn).toHaveBeenLastCalledWith('[tobos] media/quiz/answer.png is not in media.json');
    warn.mockRestore();
  });

  it('gives a glob the files it matches, by their specifiers, in order', () => {
    setMedia(
      JSON.parse(
        '{"cow/b.png": {"hash": "b"}, "cow/a.png": {"hash": "a"}, "cow/ear/c.png": {"hash": "c"}, "ox.png": {"hash": "d"}}',
      ),
    );
    expect(mediaGlob(['cow/*.png'])).toEqual({
      '$media/cow/a.png': 'media/a',
      '$media/cow/b.png': 'media/b',
    });
    expect(Object.keys(mediaGlob(['cow/**/*.png', 'ox.png']))).toEqual([
      '$media/cow/a.png',
      '$media/cow/b.png',
      '$media/cow/ear/c.png',
      '$media/ox.png',
    ]);
    expect(mediaGlob(['constructor'])).toEqual({});
  });
});
