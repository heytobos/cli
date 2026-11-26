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

  it('gives a module the media of the revision its address is in, whichever is set now', () => {
    const at = (file: string) => `https://abc.tobosusercontent.com/v/cap/m/${file}`;
    setMedia({ 'cow.jpg': { hash: 'old' } }, { '@deck/scenes/a.svelte': 'm/a1.js' });
    // A push replaced cow.jpg: scene a's address is another.
    setMedia({ 'cow.jpg': { hash: 'new' } }, { '@deck/scenes/a.svelte': 'm/a2.js' });
    // The old address, run only now (it was loading, or an undo comes back to it): the old file.
    expect(mediaUrl('cow.jpg', at('a1.js'))).toBe('media/old');
    expect(mediaGlob(['cow.*'], at('a1.js'))).toEqual({ '$media/cow.jpg': 'media/old' });
    expect(mediaUrl('cow.jpg', at('a2.js'))).toBe('media/new');
    // A module no revision listed, or compiled before modules passed their URL: the map now.
    expect(mediaUrl('cow.jpg', at('elsewhere.js'))).toBe('media/new');
    expect(mediaUrl('cow.jpg')).toBe('media/new');
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
