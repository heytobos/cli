import { describe, expect, it, vi } from 'vitest';
import { mediaUrl, setMedia, setShared } from '../src/registry.ts';

describe('media()', () => {
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
    expect(warn).toHaveBeenLastCalledWith('[tobos] media("quiz/answer.png") isn\'t available here');
    setShared(false);
    expect(mediaUrl('quiz/answer.png')).toBe('');
    expect(warn).toHaveBeenLastCalledWith('[tobos] media("quiz/answer.png") is not in media.json');
    warn.mockRestore();
  });
});
